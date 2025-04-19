const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const { getActiveApplications, getFullActivityReport } = require("./utils");
const express = require("express");
const bodyParser = require("body-parser");

const expressApp = express();
const port = 5326;
const processes = [];

let chromeActivityMessages = [];
let mainWindow;
let tray;
let timer;
let activityTimer = 0;
let allowedTime = 60;
let isTimeOver = false;
let isFullscreen = false;
let date = new Date().toISOString().slice(0, 10);

expressApp.use(bodyParser.json());

expressApp.post("/activity-status", (req, res) => {
  chromeActivityMessages.push({
    body: req.body,
    ts: new Date().toISOString().slice(0, 19),
  });
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
    mainWindow.hide();
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isFullscreen && (input.key === "Escape" || input.key === "F11")) {
      event.preventDefault();
    }
  });
};

function openFullscreen() {
  if (!isFullscreen) {
    mainWindow.setFullScreen(true);
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setMenuBarVisibility(false);
    isFullscreen = true;
  }
}

function closeFullscreen() {
  if (isFullscreen) {
    mainWindow.setFullScreen(false);
    mainWindow.setAlwaysOnTop(false);
    isFullscreen = false;
  }
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
  return filteredCAM.filter((i) => i.body.activity);
};

const getReport = () => {
  const report = processes.map((i) => {
    const { name, activeTime, title } = i;
    const report =
      name === "chrome" ? getFullActivityReport(getGoogleActivity()) : null;
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
}

function checkOtherActivity(index, app) {
  if (processes[index].lifeTime < +app.cpu.replace(",", ".")) {
    const incrementor = +app.cpu.replace(",", ".") - processes[index].lifeTime;
    processes[index].lifeTime += incrementor;

    if (incrementor > 0.1) {
      activityTimer += 1;
      processes[index].activeTime += 1;
    }
  }

  if (processes[index].mvh !== app.mvh) {
    processes[index].mvh = app.mvh;
    activityTimer += 1;
    processes[index].activeTime += 1;
  }

  if (processes[index].res !== app.res) {
    processes[index].res = app.res;

    if (app.res) {
      activityTimer += 1;
      processes[index].activeTime += 1;
    }
  }
}

async function checkActiveApplications() {
  if (new Date().toISOString().slice(0, 10) !== date) {
    date = new Date().toISOString().slice(0, 10);
    processes.forEach((i) => (i.date = new Date()));
    activityTimer = 0;
  }

  if (!isTimeOver) {
    try {
      const apps = await getActiveApplications();
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
            lifeTime: app.name === "chrome" ? 0 : +app.cpu.replace(",", "."),
            activeTime: 0,
            title: app.title
          });
        } else {
          if (processes[index].name === "chrome") {
            checkChromeActivity(index);
          } else {
            checkOtherActivity(index, app);
          }
        }
        //console.log("activityTimer: ", activityTimer);
      });
    } catch (err) {
      console.error("Ошибка при получении активных приложений:", err);
    }
    //console.log("processes: ", processes)
  }
}

app.on("ready", () => {
  tray = new Tray("./icon-100.png");
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Настройки",
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: "Выйти",
      click: () => {
        app.quit();
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
  if (activityTimer >= allowedTime) {
    isTimeOver = true;
    mainWindow.webContents.send("time-over");
    openFullscreen();
  }
}, 1000);

ipcMain.on("reset-timer", () => {
  activityTimer = 0;
  isTimeOver = false;
  closeFullscreen();
});

ipcMain.on("set-allowed-time", (event, time) => {
  allowedTime = time;
});

ipcMain.on("stop-time", () => {
  clearInterval(timer);
});

ipcMain.on("request-active-apps", (event) => {
  event.sender.send("active-apps", getReport());
});
