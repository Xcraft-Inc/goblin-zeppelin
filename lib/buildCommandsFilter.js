//Uncomment for gathering cmd in file
//const fs = require('fs');
//const os = require('os');
//const path = require('path');
//const filePath = path.join(os.tmpdir(), `commands.txt`);
//console.log(`/////////////////////gathering commands in file: ${filePath}`);
module.exports = (rules) => (cmd) => {
  //fs.appendFileSync(filePath, `${cmd}\n`);
  if (rules.indexOf(cmd) === -1) {
    return false;
  }
  return true;
};
