//Uncomment for gathering cmd in file
//const fs = require('fs');
//const os = require('os');
//const path = require('path');
//const filePath = path.join(os.tmpdir(), `commands.txt`);
//console.log(`/////////////////////gathering commands in file: ${filePath}`);
module.exports = (rules) => (cmd) => {
  //fs.appendFileSync(filePath, `${cmd}\n`);
  return rules.some((rule) => {
    if (rule.indexOf('(') == 0) {
      let cmdParts = cmd.split('.');
      if (cmdParts[1] !== rule.substr(rule.indexOf('.') + 1)) {
        return false;
      }
      // If cmd name allowed, check service name then
      let serviceNames = rule.substr(1, rule.indexOf(')') - 1);
      return serviceNames.split('|').some((serviceName) => {
        return serviceName === cmdParts[0];
      });
    } else {
      return rule === cmd;
    }
  });
};
