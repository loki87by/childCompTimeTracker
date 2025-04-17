const wmi = require('node-wmi');

module.exports.getActiveApplications = () => {
    return new Promise((resolve, reject) => {
        wmi.Query('SELECT Caption FROM Win32_Process', (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });
}

