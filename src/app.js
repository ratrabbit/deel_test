const express = require('express');
const bodyParser = require('body-parser');
const {sequelize} = require('./model');
const {getProfile} = require('./middleware/getProfile');
const {parseQueryDates} = require('./middleware/parseQueryDates');
const { Op } = require('sequelize');
const app = express();
app.use(bodyParser.json());
app.set('sequelize', sequelize)
app.set('models', sequelize.models)

//2
app.get('/contracts',getProfile ,async (req, res) => {
    const {Contract} = req.app.get('models')
    const { id } = req.profile;
    const contracts = await Contract.findAll({
      where: {
        [Op.or]: [{ContractorId: id}, {ClientId: id}],
        status: {[Op.ne]: 'terminated'}
      }
    });
    res.json(contracts)
});

//3
app.get('/jobs/unpaid', getProfile, async (req, res) => {
  const { Contract,Job } = req.app.get('models');
  const { id } = req.profile;

  const jobs = await Job.findAll({
    where: {
      paid: false
    },
    include: [
      {
        model: Contract,
        where: {
          [Op.or]: [
            {
              ContractorId: id
            },
            {
              ClientId: id
            }
          ],
          status: {[Op.eq]: 'in_progress'}
        }
      }
    ]
  });
  res.json(jobs);
});

//4
/*
  POST /jobs/:job_id/pay - Pay for a job, a client can only pay if his balance >= the amount to pay. The amount should be moved from the client's balance to the contractor balance.
*/
app.post('/jobs/:job_id/pay', getProfile, async (req, res) => {
  const { Contract,Job,Profile } = req.app.get('models');
  const transaction = await sequelize.transaction();
  const {job_id} = req.params;
  const { id } = req.profile;

  try {
    const job = await Job.findOne({
      where: {
        paid: false,
        id: job_id
      },
      include: [
        {
          model: Contract,
          where: {
            ClientId: id
          },
          include: [
            {
              model: Profile,
              as: 'Contractor'
            }
          ]
        }
      ],
      transaction
    });

    if (!job) {
      return res.status(404).end();
    }

    if (job.price > req.profile.balance) {
      return res.status(409).end();
    }

    await Promise.all([
      job.update({paid: true, paymentDate: new Date()}, {transaction}),
      req.profile.decrement('balance', {by: job.price, transaction}),
      job.Contract.Contractor.increment('balance', {by: job.price, transaction})
    ]);

    await transaction.commit();
    return res.status(200).end();
  } catch (e) {
    await transaction.rollback();
    return res.status(500).end();
  }

});


// 5 POST /balances/deposit/:userId - Deposits money into the the the balance of
// a client, a client can't deposit more than 25% his total of jobs to
// pay. (at the deposit moment)
// NOT SURE IF GET PROFILE WORKS  HERE...
// What if the total of jobs is 0?
app.post('/balances/deposit/:userId', async (req, res) => {
  const { Contract,Job,Profile } = req.app.get('models');
  const { body, params } = req;
  const { userId } = params;
  const { amount } = body;
  const user = await Profile.findOne({
    where: {
      id: userId,
      type: 'client'
    }
  });

  if (!user) {
    return res.status(404).end();
  }

  const jobs = await Job.findAll({
    where: {
      paid: false
    },
    include: [
      {
        model: Contract,
        where: {
          ClientId: userId
        }
      }
    ]
  });
  const total = jobs.reduce((acc, j) => { return acc + j.price;}, 0);
  const limit = total / 4;
  console.log(limit);
  if (limit > 0 && amount > limit) {
    return res.status(409).end();
  }

  await user.increment('balance', {by: amount});
  return res.json();

});

// 6 GET /admin/best-profession?start=<date>&end=<date> - Returns the profession
// that earned the most money (sum of jobs paid) for any contactor
// that worked in the query time range.
app.get('/admin/best-profession', parseQueryDates, async (req, res) => {
  const { start, end } = req.query;

  const result = await sequelize.query("SELECT `Profiles`.`profession`, sum(price) as paid FROM `Jobs` as `Jobs` INNER JOIN `Contracts` AS `Contracts` on `Jobs`.`contractId` = `Contracts`.`id` INNER JOIN `Profiles` AS `Profiles` ON `Contracts`.`ContractorId` = `Profiles`.`id` where `Jobs`.`paymentDate` >= :start AND `Jobs`.`paymentDate` <= :end group by profession order by paid desc limit 1",
  {
    replacements: {
      start: start.toISOString(),
      end: end.toISOString()
    },
    type: sequelize.QueryTypes.SELECT
  });
  return res.json(result[0]);
});

// 7 /admin/best-clients?start=<date>&end=<date>&limit=<integer> - returns the clients
// that paid the most for jobs in the query time period. limit query
// parameter should be applied, default limit is 2.
app.get('/admin/best-clients', parseQueryDates, async (req, res) => {
  const { start, end } = req.query;
  const limit = req.query.limit || 2;

  const result = await sequelize.query("SELECT `Profiles`.`id` AS id, sum(price) as paid, firstName || ' ' || lastName AS `fullName` FROM `Jobs` as `Jobs` INNER JOIN `Contracts` AS `Contracts` on `Jobs`.`contractId` = `Contracts`.`id` INNER JOIN `Profiles` AS `Profiles` ON `Contracts`.`ClientId` = `Profiles`.`id` where `Jobs`.`paymentDate` >= :start AND `Jobs`.`paymentDate` <= :end group by fullName order by paid desc limit :limit",
  {
    replacements: {
      start: start.toISOString(),
      end: end.toISOString(),
      limit
    },
    type: sequelize.QueryTypes.SELECT
  });
  return res.json(result);
});

/**
 * FIX ME!
 * @returns contract by id
 // 1
 */
app.get('/contracts/:id',getProfile ,async (req, res) => {
    const {Contract} = req.app.get('models')
    const {id} = req.params
    const contract = await Contract.findOne({where: {id, [Op.or]: [{ContractorId: req.profile.id}, {ClientId: req.profile.id}]}})
    if(!contract) return res.status(404).end();
    res.json(contract)
})
module.exports = app;
