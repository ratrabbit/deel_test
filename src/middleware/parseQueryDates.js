const moment = require('moment');

const parseQueryDates = async (req, res, next) => {
  const { start: rawStart, end: rawEnd } = req.query;
  if (!rawStart || !rawEnd) {
    return res.status(400).end();
  }
  const start = moment(rawStart);
  const end = moment(rawEnd);
  if (!start.isValid() || !end.isValid()) {
    return res.status(400).end();
  }
  if (end.isBefore(start)) {
    return res.status(400).end();
  }
  req.query.start = start;
  req.query.end = end;
  next();
}
module.exports = {parseQueryDates}
