const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const { getActiveApplications } = require("./utils");

let mainWindow;
let tray;
let timer;
let activityTimer = 0;
let allowedTime = 3600; // Время в секундах
let isTimeOver = false;
let allowedApps = ['App1.exe', 'App2.exe'];

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // Для работы с IPC
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");

  // Закрыть окно, но сохранить приложение в трее
  mainWindow.on("close", (event) => {
    event.preventDefault();
    mainWindow.hide(); // Скрыть окно
  });
};

function checkActiveApplications() {
    if (!isTimeOver) {
        getActiveApplications().then(apps => {
            const activeAppNames = apps.map(app => app.Caption);
            mainWindow.webContents.send('active-apps', appNames);
            const isAppAllowed = activeAppNames.some(appName => allowedApps.includes(appName));

            if (isAppAllowed) {
                activityTimer++;
            }
        }).catch(err => {
            console.error("Ошибка при получении активных приложений:", err);
        });
    }
  }

app.on("ready", () => {
  // Создать трэй и контекстное меню
  tray = new Tray("./icon.png"); // Замените на путь к вашему значку
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Настройки",
      click: () => {
        mainWindow.show();
      },
    },
    { label: "Выйти", role: "quit" },
  ]);

  tray.setToolTip("Time Tracker");
  tray.setContextMenu(contextMenu);

  createWindow();

  // Открыть окно при двойном клике по значку в трее
  tray.on("double-click", () => {
    mainWindow.show();
  });
  // Запускать мониторинг активности здесь
timer = setInterval(checkActiveApplications, 1000);
})


// Проверка необходимого времени
ipcMain.on("check-time", (event) => {
  if (activityTimer >= allowedTime) {
    isTimeOver = true;
    mainWindow.webContents.send("time-over");
    // Открыть полноэкранное предупреждение
    mainWindow.setFullScreen(true);
    mainWindow.show();
  }
});

// Для сброса таймера родителем
ipcMain.on("reset-timer", () => {
  activityTimer = 0;
  isTimeOver = false; // Сбросить статус
});

ipcMain.on("stop-time", () => {
  clearInterval(timer)
});
