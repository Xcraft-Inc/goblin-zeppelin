const {toXcraftRegExpStr} = require('xcraft-core-utils/lib/regex.js');

/*****************************************************************************/

//Uncomment for gathering cmd in file
//const fs = require('fs');
//const os = require('os');
//const path = require('path');
//const filePath = path.join(os.tmpdir(), `commands.txt`);
//console.log(`/////////////////////gathering commands in file: ${filePath}`);
const buildCommandsFilter = (rules) => (cmd) => {
  //fs.appendFileSync(filePath, `${cmd}\n`);
  return rules.some((rule) => cmd.match(toXcraftRegExpStr(rule)));
};

function createAllCommandsInGroup(commands) {
  let res = [];
  // create commands with words of group recursively
  function parseGroup(...args) {
    let words = args[1].split('|');
    words = words.map((word) => args[3].replace(/(\([^)]+\))/, word));
    res = [...res, ...createAllCommandsInGroup(words)];
  }
  for (const cmd of commands) {
    if (cmd.indexOf('(') !== -1) {
      // search for the first group in the command
      cmd.replace(/\(([^()]+)\)/, parseGroup);
    } else {
      // store command who don't need to be parsed
      res.push(cmd);
    }
  }
  return res;
}

function buildAllowedCommandsList(commands) {
  return createAllCommandsInGroup(commands).reduce((acc, cmd) => {
    acc[cmd] = true;
    return acc;
  }, {});
}

module.exports = {
  buildCommandsFilter,
  buildAllowedCommandsList,
};

// const assert = require('assert');
// it('#Create all commands variations', function () {
//   const test = '(laboratory|carnotzet).(how|when)-(ui|test)-crash';
//   let result = buildAllowedCommandsList([test]);
//   const expected = [
//     'laboratory.how-ui-crash',
//     'laboratory.how-test-crash',
//     'laboratory.when-ui-crash',
//     'laboratory.when-test-crash',
//     'carnotzet.how-ui-crash',
//     'carnotzet.how-test-crash',
//     'carnotzet.when-ui-crash',
//     'carnotzet.when-test-crash',
//   ];
//   assert.deepStrictEqual(result, expected);
// });
