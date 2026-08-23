using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace DubbingStudioLauncher
{
    class Program
    {
        private static Process _pythonProcess = null;

        static void Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
            }
            catch { }

            Console.Title = "AI Dubbing & Video Sync Studio";

            PrintBanner();

            string baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            Directory.SetCurrentDirectory(baseDir);

            string serverPy = Path.Combine(baseDir, "server.py");
            if (!File.Exists(serverPy))
            {
                PrintColored("[LỖI] Không tìm thấy file server.py trong thư mục: " + baseDir, ConsoleColor.Red);
                Console.WriteLine("\nVui lòng đặt file EXE này cùng thư mục với server.py và các file dự án.");
                Console.WriteLine("\nNhấn phím bất kỳ để thoát...");
                Console.ReadKey();
                return;
            }

            string pythonExe = FindPythonExecutable(baseDir);
            if (string.IsNullOrEmpty(pythonExe) || !File.Exists(pythonExe))
            {
                PrintColored("[LỖI] Không tìm thấy Python trên máy tính của bạn!", ConsoleColor.Red);
                Console.WriteLine("\nVui lòng cài đặt Python (phiên bản 3.10 trở lên) và tích chọn 'Add Python to PATH'.");
                Console.WriteLine("Hoặc tạo môi trường ảo .venv / venv trong thư mục này.");
                Console.WriteLine("\nNhấn phím bất kỳ để thoát...");
                Console.ReadKey();
                return;
            }

            PrintColored("[✓] Đã tìm thấy Python: " + pythonExe, ConsoleColor.Green);
            PrintColored("[✓] Thư mục làm việc: " + baseDir, ConsoleColor.Cyan);

            string serverUrl = "http://127.0.0.1:8000";
            PrintColored("[✓] Đang khởi động Backend Server tại " + serverUrl + " ...", ConsoleColor.Yellow);
            Console.WriteLine(new string('-', 64));

            // Check if port 8000 is already open before starting
            if (IsPortListening("127.0.0.1", 8000))
            {
                PrintColored("[!] Cổng 8000 đang được sử dụng (Server có thể đang chạy sẵn).", ConsoleColor.Yellow);
                PrintColored("[✓] Mở trình duyệt tới giao diện...", ConsoleColor.Green);
                OpenBrowser(serverUrl);
                Console.WriteLine("\nNhấn Enter để thoát launcher này (server đang chạy ở tiến trình khác)...");
                Console.ReadLine();
                return;
            }

            // Build uvicorn arguments
            string extraArgs = args != null && args.Length > 0 ? " " + string.Join(" ", args) : " --reload";
            string uvicornArgs = "-m uvicorn server:app --host 127.0.0.1 --port 8000" + extraArgs;

            // Setup exit handler to terminate python on close/Ctrl+C
            AppDomain.CurrentDomain.ProcessExit += OnProcessExit;
            Console.CancelKeyPress += OnCancelKeyPress;

            // Start python process
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = pythonExe,
                Arguments = uvicornArgs,
                WorkingDirectory = baseDir,
                UseShellExecute = false,
                CreateNoWindow = false
            };

            // Ensure UTF-8 env for python
            if (psi.EnvironmentVariables.ContainsKey("PYTHONIOENCODING"))
                psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            else
                psi.EnvironmentVariables.Add("PYTHONIOENCODING", "utf-8");

            if (psi.EnvironmentVariables.ContainsKey("PYTHONUTF8"))
                psi.EnvironmentVariables["PYTHONUTF8"] = "1";
            else
                psi.EnvironmentVariables.Add("PYTHONUTF8", "1");

            try
            {
                _pythonProcess = Process.Start(psi);
            }
            catch (Exception ex)
            {
                PrintColored("[LỖI] Không thể khởi động Python server: " + ex.Message, ConsoleColor.Red);
                Console.WriteLine("\nNhấn phím bất kỳ để thoát...");
                Console.ReadKey();
                return;
            }

            // Launch background thread to open browser once server is responsive
            Thread browserThread = new Thread(() => AutoOpenBrowser(serverUrl));
            browserThread.IsBackground = true;
            browserThread.Start();

            if (_pythonProcess != null)
            {
                _pythonProcess.WaitForExit();
            }
        }

        private static void AutoOpenBrowser(string url)
        {
            // Wait up to 10 seconds for server to respond
            int maxRetries = 20;

            for (int i = 0; i < maxRetries; i++)
            {
                Thread.Sleep(500);
                if (_pythonProcess == null || _pythonProcess.HasExited)
                    return;

                if (IsPortListening("127.0.0.1", 8000))
                {
                    break;
                }
            }

            Thread.Sleep(300);
            OpenBrowser(url);
        }

        private static void OpenBrowser(string url)
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true
                });
                PrintColored("\n[✓] Đã tự động mở giao diện tại: " + url, ConsoleColor.Green);
                PrintColored("[i] Giữ cửa sổ này hoạt động trong suốt quá trình sử dụng tool.", ConsoleColor.DarkGray);
                PrintColored("[i] Đóng cửa sổ này hoặc nhấn Ctrl+C để tắt server.\n", ConsoleColor.DarkGray);
            }
            catch
            {
                try
                {
                    Process.Start("explorer", url);
                }
                catch { }
            }
        }

        private static bool IsPortListening(string host, int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(200);
                    if (success && client.Connected)
                    {
                        client.EndConnect(result);
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        private static string FindPythonExecutable(string baseDir)
        {
            // 1. Check local virtual environments first
            string[] localVenvs = new string[]
            {
                Path.Combine(baseDir, ".venv", "Scripts", "python.exe"),
                Path.Combine(baseDir, "venv", "Scripts", "python.exe"),
                Path.Combine(baseDir, "env", "Scripts", "python.exe")
            };

            foreach (var venvPy in localVenvs)
            {
                if (File.Exists(venvPy))
                    return venvPy;
            }

            // 2. Check PATH environment variable
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] pathDirs = pathEnv.Split(';');
            foreach (var dir in pathDirs)
            {
                if (string.IsNullOrWhiteSpace(dir)) continue;
                try
                {
                    string candidate = Path.Combine(dir.Trim(), "python.exe");
                    if (File.Exists(candidate) && !candidate.ToLower().Contains("windowsapps"))
                    {
                        return candidate;
                    }
                }
                catch { }
            }

            // 3. Check AppData Local Programs
            try
            {
                string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string pyDir = Path.Combine(localApp, "Programs", "Python");
                if (Directory.Exists(pyDir))
                {
                    var dirs = Directory.GetDirectories(pyDir, "Python3*");
                    Array.Sort(dirs);
                    Array.Reverse(dirs); // newest first
                    foreach (var d in dirs)
                    {
                        string candidate = Path.Combine(d, "python.exe");
                        if (File.Exists(candidate))
                            return candidate;
                    }
                }
            }
            catch { }

            // 4. Check Root C:\Python3*
            try
            {
                var dirs = Directory.GetDirectories(@"C:\", "Python3*");
                Array.Sort(dirs);
                Array.Reverse(dirs);
                foreach (var d in dirs)
                {
                    string candidate = Path.Combine(d, "python.exe");
                    if (File.Exists(candidate))
                        return candidate;
                }
            }
            catch { }

            return null;
        }

        private static void OnCancelKeyPress(object sender, ConsoleCancelEventArgs e)
        {
            KillPythonProcess();
        }

        private static void OnProcessExit(object sender, EventArgs e)
        {
            KillPythonProcess();
        }

        private static void KillPythonProcess()
        {
            if (_pythonProcess != null && !_pythonProcess.HasExited)
            {
                try
                {
                    // Kill process tree
                    ProcessStartInfo killPsi = new ProcessStartInfo
                    {
                        FileName = "taskkill",
                        Arguments = "/F /T /PID " + _pythonProcess.Id,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    Process.Start(killPsi);
                }
                catch
                {
                    try { _pythonProcess.Kill(); } catch { }
                }
            }
        }

        private static void PrintBanner()
        {
            Console.ForegroundColor = ConsoleColor.Cyan;
            Console.WriteLine(@"
╔══════════════════════════════════════════════════════════════╗
║              AI DUBBING & VIDEO SYNC STUDIO                  ║
║                  Native Launcher (EXE)                       ║
╚══════════════════════════════════════════════════════════════╝");
            Console.ResetColor();
        }

        private static void PrintColored(string text, ConsoleColor color)
        {
            Console.ForegroundColor = color;
            Console.WriteLine(text);
            Console.ResetColor();
        }
    }
}
