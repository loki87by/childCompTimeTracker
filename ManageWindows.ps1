param(
    [string]$processName
)

# Используем P/Invoke для вызова WinAPI
try {
    [void][User32WinAPI]
} catch {
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class User32WinAPI {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
}

# Загружаем сборку для работы с Windows Forms
Add-Type -AssemblyName System.Windows.Forms

# Получаем процессы
$processes = Get-Process -Name $processName -ErrorAction SilentlyContinue

if ($processes) {
    # Выбираем первый процесс из списка
    $process = $processes | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1

    if ($process) {
        $hwnd = $process.MainWindowHandle

        # Получаем размеры окна
        $rect = New-Object User32WinAPI+RECT
        $success = [User32WinAPI]::GetWindowRect($hwnd, [ref]$rect)

        if ($success) {
            # Определяем размеры экрана
            $screenWidth = [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
            $screenHeight = [System.Windows.Forms.SystemInformation]::VirtualScreen.Height
            
            # Проверяем, находится ли окно в полноэкранном режиме
            $isFullscreen = (($rect.Right - $rect.Left) -eq $screenWidth -and ($rect.Bottom - $rect.Top) -eq $screenHeight)

            # Проверяем стиль окна
            $style = [User32WinAPI]::GetWindowLong($hwnd, -16) # GWL_STYLE
            $isPopup = ($style -band 0x80000000) -ne 0 # WS_POPUP
            $hasCaption = ($style -band 0xC00000) -ne 0 # WS_CAPTION AND WS_THICKFRAME

            if ($isFullscreen -or ($isPopup -and -not $hasCaption)) {
                Write-Host "Окно '$processName' находится в полноэкранном режиме. Симуляция нажатия F11..."
                
                # Симуляция нажатия ESC и пробела
                [System.Windows.Forms.SendKeys]::SendWait(" ")
                [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
            } else {
                Write-Host "Окно '$processName' не находится в полноэкранном режиме."
            }

            # Минимизируем окно
            [User32WinAPI]::ShowWindow($hwnd, 2) # SW_MINIMIZE
            Write-Host "Окно '$processName' было минимизировано."
        } else {
            Write-Host "Не удалось получить размеры окна."
        }
    } else {
        Write-Host "У процессов с именем '$processName' нет активного окна."
    }
} else {
    Write-Host "Процесс с указанным именем '$processName' не найден."
}
