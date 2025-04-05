import { exec } from 'child_process';

const PROCESS_NAME = 'Minecraft.Windows'; 
const TARGET_PRIORITY_NAME = 'High';   
const CHECK_INTERVAL_MS = 5000;   

function runPowerShell(command: string): Promise<{ stdout: string; stderr: string }> {
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
    const psCommand = `powershell.exe -EncodedCommand ${encodedCommand}`;

    return new Promise((resolve, reject) => {
        exec(psCommand, { windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                error.message += `\nStderr: ${stderr}`;
                const psErrorMatch = stderr.match(/Error:\s*([\s\S]*)/);
                if (psErrorMatch && psErrorMatch[1]) {
                    console.error(`PowerShell Error: ${psErrorMatch[1].trim()}`);
                }
                reject(error);
            } else {
                resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
            }
        });
    });
}

async function getMinecraftPriority(): Promise<string | null> {
    const command = `
        $ErrorActionPreference = 'SilentlyContinue'
        $proc = Get-Process -Name '${PROCESS_NAME}' -ErrorAction SilentlyContinue
        if ($null -ne $proc) {
            return ($proc | Select-Object -First 1).PriorityClass.ToString()
        } else {
            return $null
        }
    `;
    try {
        const { stdout } = await runPowerShell(command);
        return stdout ? stdout : null; 
    } catch (error: any) {
        if (!error.message.includes('Cannot find a process')) {
            console.warn(`Warning getting process priority: ${error.message}`);
        }
        return null;
    }
}

async function setMinecraftPriorityHigh(): Promise<boolean> {
    const command = `
        $ErrorActionPreference = 'Stop' 
        try {
            $proc = Get-Process -Name '${PROCESS_NAME}'
            if ($proc.PriorityClass -ne [System.Diagnostics.ProcessPriorityClass]::High) {
                Write-Host "Setting priority to ${TARGET_PRIORITY_NAME}..."
                $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::High
                $proc.Refresh()
                if ($proc.PriorityClass -eq [System.Diagnostics.ProcessPriorityClass]::High) {
                    Write-Host "Priority set to ${TARGET_PRIORITY_NAME} successfully for PID: $($proc.Id)."
                    return $true
                } else {
                    Write-Warning "Failed to verify priority change. Current: $($proc.PriorityClass)"
                    return $false
                }
            } else {
                 # Write-Host "Priority is already ${TARGET_PRIORITY_NAME}."
                 return $true 
            }
        } catch {
            Write-Warning "Failed to set priority for ${PROCESS_NAME}. Error: $($_.Exception.Message)"
            if ($_.Exception.Message -like '*Access is denied*') {
                Write-Warning "This likely means the script is not running with Administrator privileges."
            }
            return $false
        }
    `;
    try {
        const { stdout, stderr } = await runPowerShell(command);
        if (stdout.includes("successfully")) {
            console.log(stdout); 
            return true;
        } else if (stderr) {
            console.error(`Error setting priority: ${stderr}`);
            return false;
        } else if (stdout.includes("already")) {
            return true;
        } else if (stdout.includes("Failed to verify")) {
            console.warn(stdout); 
            return false;
        }
        console.warn(`Setting priority might have failed. PowerShell output:\n${stdout}`);
        return false;
    } catch (error: any) {
        console.error(`Failed to execute PowerShell command: ${error.message}`);
        return false;
    }
}

async function checkAdmin(): Promise<boolean> {
    return new Promise((resolve) => {
        exec('net session', { windowsHide: true }, (error) => {
            resolve(!error); 
        });
    });
}


async function main() {
    console.log(`Minecraft Priority Setter (Process: ${PROCESS_NAME}.exe)`);
    console.log(`チェック間隔 ${CHECK_INTERVAL_MS / 1000} 秒事 Ctrl + Cで終了します`);
    console.log("-------------------------------------------------------");

    const isAdmin = await checkAdmin();
    if (!isAdmin) {
        console.warn("*******************************************************");
        console.warn("WARNING:  管理者として実行されていません");
        console.warn("管理者として実行して下さい");
        console.warn("*******************************************************");
    }


    setInterval(async () => {
        try {
            const currentPriority = await getMinecraftPriority();

            if (currentPriority === null) {
            } else if (currentPriority === TARGET_PRIORITY_NAME) {
            } else {
                console.log(`${new Date().toLocaleTimeString()} - ${PROCESS_NAME}.exe found. Current priority: ${currentPriority}. Attempting to set to ${TARGET_PRIORITY_NAME}...`);
                await setMinecraftPriorityHigh();
            }
        } catch (error) {
            console.error(`${new Date().toLocaleTimeString()} - An unexpected error occurred in the check loop:`, error);
        }
    }, CHECK_INTERVAL_MS);
}

main();