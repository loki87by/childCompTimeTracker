param(
    [string]$processName,
    [switch]$skipSpaceSimulation
)

# Используем P/Invoke для вызова WinAPI
try {
    [void][User32WinAPI]
} catch {
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class User32Keyboard {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    
    public const int KEYEVENTF_KEYUP = 0x0002;
    public const int VK_SPACE = 0x20; // Пробел
    public const int VK_ESCAPE = 0x1B; // Escape
}
"@
}

# Получаем процессы
$processes = Get-Process -Name $processName -ErrorAction SilentlyContinue

if ($processes) {
    # Выбираем первый процесс из списка
    $process = $processes | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1

    if ($process) {
        $hwnd = $process.MainWindowHandle
        # Устанавливаем фокус на окно процесса
        [User32Keyboard]::SetForegroundWindow($hwnd)

        if (-not $skipSpaceSimulation) {
            # Симуляция пробела только если флаг не установлен
            [User32Keyboard]::keybd_event([User32Keyboard]::VK_SPACE, 0, 0, [UIntPtr]::Zero) # Нажатие
            Start-Sleep -Milliseconds 100 # Задержка между нажатиями
            [User32Keyboard]::keybd_event([User32Keyboard]::VK_SPACE, 0, [User32Keyboard]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) # Отпускание
        }
        # Имитируем нажатие "Escape"
        [User32Keyboard]::keybd_event([User32Keyboard]::VK_ESCAPE, 0, 0, [UIntPtr]::Zero) # Нажатие
        Start-Sleep -Milliseconds 100 # Задержка
        [User32Keyboard]::keybd_event([User32Keyboard]::VK_ESCAPE, 0, [User32Keyboard]::KEYEVENTF_KEYUP, [UIntPtr]::Zero) # Отпускание
        
        Write-Host "OK"
    } else {
        Write-Host "LOST"
    }
} else {
    Write-Host "NOTFOUND"
}
