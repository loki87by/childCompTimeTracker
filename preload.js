const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    send: (channel, data) => {
        // Разрешить только определенные каналы
        const validChannels = ['set-allowed-time', 'reset-timer'];
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        }
    },
    on: (channel, func) => {
        const validChannels = ['time-over'];
        if (validChannels.includes(channel)) {
            // И слушаем только определенные каналы
            ipcRenderer.on(channel, (event, ...args) => func(...args));
        }
    }
});
