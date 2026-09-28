/**
 * Team Seat Fee Job
 *
 * One day's share of every team's monthly seat fee, billed daily so that a
 * member who joins mid-month is paid for from the day they join and no day is
 * ever given away. Does nothing at all unless the platform has switched seat
 * fees on (`features.teams.seatFeeEnabled`).
 *
 * Running it twice in a day is harmless: each day is claimed once, on a unique
 * index — see services/team/seatFeeService.
 */
const seatFeeService = require('../services/team/seatFeeService');

const run = async () => {
  const summary = await seatFeeService.runDaily(new Date());
  return summary;
};

module.exports = { run };
