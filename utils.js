const { exec } = require("child_process");
const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");

dotenv.config({ path: envPath });

const allowedApps = process.env["ALLOWED_APPS"].split(",");

let isProcessRunning = false;

module.exports.manageWindow = (processName, power) => {
  if (
    allowedApps
      .map((i) => i.toLowerCase())
      .includes(processName.toLowerCase().trim())
  ) {
    return;
  }

  isProcessRunning = true;
  const psScript = path.join(
    __dirname,
    power ? "ManageWindows.ps1" : "SimulateKeyPress.ps1"
  );
  return new Promise((resolve, reject) => {
    if (isProcessRunning) {
      return Promise.reject(
        `Пропущено выполнение, так как уже запущен процесс для ${processName}.`
      );
    }
    exec(
      `powershell.exe -ExecutionPolicy Bypass -File "${psScript}" -processName "${processName}"`,
      (error, stdout, stderr) => {
        if (error) {
          isProcessRunning = false;
          reject(`Ошибка: ${error.message}`);
          return;
        }
        if (stderr) {
          isProcessRunning = false;
          reject(`Ошибка: ${stderr}`);
          return;
        }
        isProcessRunning = false;
        resolve(`${stdout}`);
      }
    );
  });
};

module.exports.getActiveApplications = async () => {
  const command = `Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id, CPU, ProcessName, StartTime, MainWindowHandle, Responding, MainWindowTitle | Format-Table -AutoSize`;

  const path = `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  return new Promise((resolve, reject) => {
    exec(`${path} -Command "${command}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Ошибка: ${error.message}`);
        reject(error);
        return;
      }

      if (stderr) {
        console.error(`Ошибка: ${stderr}`);
        reject(stderr);
        return;
      }

      const activeWindows = stdout.trim().split("\n").slice(2);
      const result = activeWindows
        .map((line) => line.replace("\r", "").trim())
        .filter((line) => line !== "")
        .map((i) => {
          const columns = i.split(/\s+/);
          return {
            id: columns[0],
            cpu: columns[1],
            name: columns[2],
            date: new Date(columns[3].split(".").reverse().join("-")),
            mwh: columns[5],
            res: columns[6],
            title: columns.slice(7).join(" "),
          };
        });
      resolve(result.filter((i) => !allowedApps.includes(i.name)));
    });
  });
};

const getActivityRanges = (array, configCode) => {
  return array.reduce((p, i) => {
    const last = p[p.length - 1];
    let config = null;
    const body = i.body ? i.body : i;
    if (last) {
      switch (configCode) {
        case 1:
          config = Date.parse(last.ts2) + 1000 >= Date.parse(i.ts);
          break;
        case 2:
          config = last.body[last.body.length - 1].src === body.src;
          break;
        case 3:
          config = last.body[last.body.length - 1].type === body.type;
          break;
        default:
          config = null;
      }
    }

    if (config) {
      last.ts2 = i.ts;
      body.ts = i.ts;
      last.body.push(body);
    } else {
      body.ts = i.ts;
      const el = {
        ts1: i.ts,
        ts2: i.ts,
        body: [body],
      };
      p.push(el);
    }
    return p;
  }, []);
};

const rangePrepare = (range) => {
  const { body } = range;
  const sourceRanges = getActivityRanges(body, 2);
  return sourceRanges.map((i) => {
    const { body } = i;
    return getActivityRanges(body, 3);
  });
};

const countByField = (array, field) => {
  return array.reduce((acc, item) => {
    item.body.forEach((element) => {
      const key = element[field];
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, {});
};

module.exports.getFullActivityReport = (data) => {
  const dataWithTs = data.map((item) => {
    item.ts = new Date(item.ts);
    return item;
  });
  dataWithTs.sort((a, b) => {
    return a.ts > b.ts ? 1 : a.ts < b.ts ? -1 : 0;
  });
  const activityRanges = getActivityRanges(dataWithTs, 1);
  const preparedRanges = activityRanges.map((i) => rangePrepare(i));
  const flattenedRanges = preparedRanges.flat(2);
  const sources = countByField(flattenedRanges, "src");
  const types = countByField(flattenedRanges, "type");
  const total = flattenedRanges.map((interval) => {
    const addTz = (hours) => {
      return +hours + 6;
    };
    const time1 = interval.ts1.toISOString().slice(11, 19).split(":");
    time1[0] = addTz(time1[0]);
    const time1Tz = time1.join(":");
    const time2 = interval.ts2.toISOString().slice(11, 19).split(":");
    time2[0] = addTz(time2[0]);
    const time2Tz = time2.join(":");
    const timeRange =
      time1Tz === time2Tz ? `В ${time1Tz} ` : `С ${time1Tz} по ${time2Tz} `;
    return `${timeRange}- ${interval.body[0].type} на сайте: ${interval.body[0].src}`;
  });
  const result = { sources, types, total };
  return result;
};
