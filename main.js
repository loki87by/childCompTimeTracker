const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  getActiveApplications,
  getFullActivityReport,
  manageWindow,
} = require("./utils");
const express = require("express");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");

const envPath = path.resolve(__dirname, ".env");

dotenv.config({ path: envPath });

const VIDEO_PLAYERS = process.env["VIDEO_PLAYERS"].split(",");
const BROWSER_LIST = process.env["BROWSER_LIST"].split(",");
const parentPassword = process.env["PARENTS_PASSWORD"];
const activityShifting = process.env["ACTIVITY_SHIFTING"];
const expressApp = express();
const port = 5326;
const processes = [];
const powershellLogs = [];

let chromeActivityMessages = [];
let savedActivityMessages = [];
let mainWindow;
let tray;
let timer;
let uncontrol = 0;
let activityTimer = 0;
let allowedTime = +process.env["ALLOWED_TIME_DEFAULT"];
let iterationTime = +process.env["ITERATION_TIME_DEFAULT"];
let iterationTimeCount = 0;
let isTimeOver = false;
let isFullscreen = false;
let chromeVideoActivity = false;
let vmcVideoActivity = false;
let currentVideoPlayer;
let currentBrowser;
let date = new Date().toISOString().slice(0, 10);
const activityTypes = [
  `Активность мыши`,
  `Ввод текста`,
  "Воспроизведение видео",
];

if (iterationTime >= allowedTime) {
  iterationTime = 24 * 60 * 60;
}

expressApp.use(bodyParser.json());

expressApp.post("/activity-status", (req, res) => {
  chromeActivityMessages.push({
    body: req.body,
    ts: new Date().toISOString().slice(0, 19),
  });
  if (req.body.activity && req.body.type === "Воспроизведение видео") {
    chromeVideoActivity = true;
  } else {
    chromeVideoActivity = false;
  }
  res.sendStatus(200);
});

expressApp.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: true,
    icon: path.join(__dirname, "favicon.ico"),
    fullscreen: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      enableRemoteModule: false,
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("close", (event) => {
    event.preventDefault();
    if (!isFullscreen) {
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isFullscreen && (input.key === "Escape" || input.key === "F11")) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("send-password", parentPassword);
  });
};

async function videoBlocker() {
  if (vmcVideoActivity && currentVideoPlayer) {
    const log = await manageWindow(currentVideoPlayer);
    powershellLogs.push("");
    fs.writeFileSync(
      path.join(__dirname, "logs.txt"),
      `${powershellLogs.length + 1}. ${log}`
    );
    vmcVideoActivity = false;
    currentVideoPlayer = null;
  }
  if (chromeVideoActivity) {
    const lastVideoActivity = [...chromeActivityMessages]
      .reverse()
      .find(
        (msg) => msg.body.activity && msg.body.type === "Воспроизведение видео"
      );

    const isRutube = lastVideoActivity?.body?.src?.includes("rutube") || false;

    if (!isRutube && lastVideoActivity) {
      try {
        await mainWindow.webContents.send(
          "pause-video",
          lastVideoActivity.body.src
        );
      } catch (e) {
        console.error("Ошибка при отправке pause команды:", e);
      }
    }

    const res = await manageWindow(currentBrowser, {
      skipSpaceSimulation: !isRutube,
    });
    powershellLogs.push(``);
    fs.writeFileSync(
      path.join(__dirname, "logs.txt"),
      `${powershellLogs.length + 1}. ${log}`
    );
    if (res !== "OK") {
      const log = await manageWindow(currentBrowser, {
        skipSpaceSimulation: !isRutube,
        forcePowerShell: true,
      });
      powershellLogs.push(``);
      fs.writeFileSync(
        path.join(__dirname, "logs.txt"),
        `${powershellLogs.length + 1}. ${log}`
      );
    }
    chromeVideoActivity = false;
  }
  return;
}

async function openFullscreen() {
  if (!isFullscreen) {
    await videoBlocker();
    isFullscreen = true;
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setMenuBarVisibility(false);
    mainWindow.focus();
  }
}

function closeFullscreen() {
  if (isFullscreen) {
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    isFullscreen = false;
    mainWindow.hide();
  }
}

function updateBrowserActivity(array) {
  const arr = JSON.parse(JSON.stringify(array));
  const oneMinute = activityShifting * 1000;
  const length = arr.length;
  let activeIndices = [];

  for (let i = 0; i < length; i++) {
    if (arr[i].body.activity) {
      activeIndices.push(i);
    }
  }

  for (let i = 0; i < activeIndices.length - 1; i++) {
    const startIdx = activeIndices[i];
    const endIdx = activeIndices[i + 1];
    const startTime = new Date(arr[startIdx].ts).getTime();
    const endTime = new Date(arr[endIdx].ts).getTime();

    if (
      endTime - startTime < oneMinute &&
      arr[startIdx].body.src === arr[endIdx].body.src &&
      activityTypes.includes(arr[startIdx].body.type) &&
      activityTypes.includes(arr[endIdx].body.type)
    ) {
      for (let j = startIdx + 1; j < endIdx; j++) {
        const current = arr[j];

        if (
          !current.body.activity &&
          current.body.type === arr[startIdx].body.type &&
          current.body.src === arr[startIdx].body.src
        ) {
          current.body.activity = true;
        }
      }
    }
  }
  const res = Array.from(new Set(arr));

  if (res.length >= 600) {
    const empty = res.every((i) => !i.body.activity);
    const centerIndex = Math.floor(res.length / 2);
    const centerElement = res[centerIndex];

    if (empty) {
      chromeActivityMessages = chromeActivityMessages.filter(
        (i) => i.ts > centerElement.ts
      );
      return res;
    }

    let leftIndex, rightIndex;

    for (let i = centerIndex - 1; i >= 0; i--) {
      if (
        res[i].body.activity !== centerElement.body.activity ||
        res[i].body.src !== centerElement.body.src ||
        res[i].body.type !== centerElement.body.type
      ) {
        leftIndex = i;
        break;
      }
    }

    for (let i = centerIndex + 1; i < res.length; i++) {
      if (
        res[i].body.activity !== centerElement.body.activity ||
        res[i].body.src !== centerElement.body.src ||
        res[i].body.type !== centerElement.body.type
      ) {
        rightIndex = i;
        break;
      }
    }
    const leftShift = centerIndex - leftIndex;
    const rightShift = rightIndex - centerIndex;
    const currentShift =
      leftShift && !isNaN(leftShift) && rightShift && !isNaN(rightShift)
        ? Math.min(rightShift, leftShift)
        : (!leftShift || isNaN(leftShift)) && !rightShift && isNaN(rightShift)
        ? null
        : !leftShift || isNaN(leftShift)
        ? rightShift
        : leftShift;

    if (currentShift) {
      const currentIndex =
        currentShift === rightShift ? centerIndex + rightShift : centerIndex - leftShift;
      const ts = res[currentIndex].ts;
      const preDeleted = res
        .filter((i) => i.ts <= ts)
        .filter((i) => i.body.activity);
      savedActivityMessages.push(...preDeleted);
      chromeActivityMessages = chromeActivityMessages.filter((i) => i.ts > ts);
    }
  }
  return res;
}

const getGoogleActivity = () => {
  const filteredCAM = chromeActivityMessages.reduce((p, i) => {
    const ind = p.findIndex((x) => x.ts === i.ts);
    if (ind === -1) {
      p.push(i);
    } else {
      if (p[ind].body.activity !== i.body.activity) {
        p[ind].body = p[ind].body.activity ? p[ind].body : i.body;
      }
    }
    return p;
  }, []);
  const changedBrowserActivity = updateBrowserActivity(filteredCAM);
  return [...savedActivityMessages, ...changedBrowserActivity].filter(
    (i) => i.body.activity
  );
};

const getReport = () => {
  const report = processes.map((i) => {
    const { name, activeTime, title } = i;
    const report = BROWSER_LIST.includes(name)
      ? getFullActivityReport(getGoogleActivity())
      : null;
    return { name, activeTime, title, report };
  });
  return report;
};

function checkChromeActivity(index) {
  const activitySeconds = getGoogleActivity().length;
  const incrementor = activitySeconds - processes[index].lifeTime;
  processes[index].lifeTime = activitySeconds;
  processes[index].activeTime = activitySeconds;
  activityTimer += incrementor;
  iterationTimeCount += incrementor;
}

function checkOtherActivity(index, app) {
  function updateActivity() {
    activityTimer += 1;
    iterationTimeCount += 1;
    processes[index].activeTime += 1;
    if (VIDEO_PLAYERS.includes(app.name)) {
      currentVideoPlayer = app.name;
      vmcVideoActivity = true;
    }
  }

  if (processes[index].lifeTime < +app.cpu.replace(",", ".")) {
    const incrementor = +app.cpu.replace(",", ".") - processes[index].lifeTime;
    processes[index].lifeTime += incrementor;

    if (incrementor > 0.1) {
      updateActivity();
    }
  }

  if (processes[index].mvh !== app.mvh) {
    processes[index].mvh = app.mvh;
    updateActivity();
  }

  if (processes[index].res !== app.res) {
    processes[index].res = app.res;

    if (app.res) {
      updateActivity();
    }
  }
}

async function checkActiveApplications() {
  if (Boolean(uncontrol)) {
    activityTimer = 0;
    iterationTimeCount = 0;
    isTimeOver = false;
    isFullscreen = false;
    chromeVideoActivity = false;
    vmcVideoActivity = false;
    return;
  }
  if (new Date().toISOString().slice(0, 10) !== date) {
    date = new Date().toISOString().slice(0, 10);
    processes.forEach((i) => (i.date = new Date()));
    activityTimer = 0;
    iterationTimeCount = 0;
    chromeActivityMessages = [];
    savedActivityMessages = [];
    isTimeOver = false;
    isFullscreen = false;
    chromeVideoActivity = false;
    vmcVideoActivity = false;
  }

  if (!isTimeOver) {
    try {
      const apps = await getActiveApplications();
      vmcVideoActivity = false;
      currentVideoPlayer = null;
      apps.forEach((app) => {
        const index = processes.findIndex(
          (i) => i.name === app.name && i.id === app.id
        );
        if (index === -1) {
          processes.push({
            name: app.name,
            id: app.id,
            date: app.date,
            mwh: app.mwh,
            res: app.res,
            lifeTime: BROWSER_LIST.includes(app.name)
              ? 0
              : +app.cpu.replace(",", "."),
            activeTime: 0,
            title: app.title,
          });
        } else {
          if (BROWSER_LIST.includes(processes[index].name)) {
            currentBrowser = processes[index].name;
            checkChromeActivity(index);
          } else {
            checkOtherActivity(index, app);
          }
        }
      });
    } catch (err) {
      console.error("Ошибка при получении активных приложений:", err);
    }
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on("ready", () => {
  tray = new Tray(path.join(__dirname, "icon-100.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Развернуть",
      click: () => {
        mainWindow.show();
      },
    },
  ]);

  tray.setToolTip("Time Tracker");
  tray.setContextMenu(contextMenu);

  createWindow();

  tray.on("double-click", () => {
    mainWindow.show();
  });
  timer = setInterval(checkActiveApplications, 1000);
});

setInterval(() => {
  if (iterationTimeCount > iterationTime) {
    if (!isTimeOver) {
      const blockedTime = iterationTime * 2;
      mainWindow.webContents.send("time-pause", blockedTime);
      isTimeOver = true;
      openFullscreen();
      setTimeout(() => {
        closeFullscreen();
        iterationTimeCount = 0;
        isTimeOver = false;
        mainWindow.webContents.send("time-start");
      }, blockedTime * 1000);
    }
  }
}, 1000);
setInterval(() => {
  if (activityTimer >= allowedTime) {
    if (!isTimeOver) {
      mainWindow.webContents.send("time-over");
      isTimeOver = true;
      openFullscreen();
    }
  }
}, 1000);

ipcMain.on("reset-timer", () => {
  activityTimer = 0;
  iterationTimeCount = 0;
  isTimeOver = false;
  closeFullscreen();
});

ipcMain.on("set-allowed-time", (event, time) => {
  allowedTime = time;
});

ipcMain.on("set-iterations-time", (event, time) => {
  iterationTime = time;
  if (time >= allowedTime) {
    iterationTime = 24 * 60 * 60;
  }
});

ipcMain.on("set-uncontrol-range", (event, val) => {
  uncontrol = +val;
});

ipcMain.on("stop-time", () => {
  clearInterval(timer);
});

ipcMain.on("request-active-apps", (event) => {
  event.sender.send("active-apps", getReport());
});
