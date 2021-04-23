/********************************* Helper ************************************/

function getItemsFromGroup(str) {
  let startGroup = str.indexOf('(');
  let endGroup = str.indexOf(')');
  const pref = str.substring(0, startGroup);
  const suff = str.substring(endGroup + 1, str.length);
  const items = str.substring(startGroup + 1, endGroup).split('|');
  return {pref, suff, items};
}

/*****************************************************************************/

//Uncomment for gathering cmd in file
//const fs = require('fs');
//const os = require('os');
//const path = require('path');
//const filePath = path.join(os.tmpdir(), `commands.txt`);
//console.log(`/////////////////////gathering commands in file: ${filePath}`);
const buildCommandsFilter = (rules) => (cmd) => {
  //fs.appendFileSync(filePath, `${cmd}\n`);
  const c = cmd.split('.');
  return rules.some((rule) => {
    let allowed = [];
    const r = rule.split('.');
    // [0] service name [1] quest name
    for (let i = 0; i < 2; i++) {
      if (r[i].indexOf('(') !== -1) {
        const {pref, suff, items} = getItemsFromGroup(r[i]);
        const res = items.some((item) => `${pref}${item}${suff}` === c[i]);
        allowed.push(res);
      } else {
        allowed.push(r[i] === c[i]);
      }
    }
    return allowed[0] && allowed[1];
  });
};

const buildAllowedCommandsList = (rules) =>
  rules.reduce((acc, rule) => {
    const r = rule.split('.');
    // [0] service name [1] quest name
    const {pref, suff, items} = getItemsFromGroup(r[0]);
    for (const item1 of items) {
      const {pref: pref2, suff: suff2, items: items2} = getItemsFromGroup(r[1]);
      for (const item2 of items2) {
        let cmd = `${pref}${item1}${suff}.${pref2}${item2}${suff2}`;
        acc[cmd] = true;
      }
    }
    return acc;
  }, {});

module.exports = {
  buildCommandsFilter,
  buildAllowedCommandsList,
};
