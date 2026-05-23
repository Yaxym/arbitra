// Простой логгер с цветами

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

class Logger {
  private minLevel: LogLevel;
  
  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }
  
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }
  
  private formatTime(): string {
    return new Date().toISOString().slice(11, 23);
  }
  
  info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    console.log(`${colors.gray}[${this.formatTime()}]${colors.reset} ${colors.blue}INFO${colors.reset} ${message}`, ...args);
  }
  
  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(`${colors.gray}[${this.formatTime()}]${colors.reset} ${colors.yellow}WARN${colors.reset} ${message}`, ...args);
  }
  
  error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    console.error(`${colors.gray}[${this.formatTime()}]${colors.reset} ${colors.red}ERROR${colors.reset} ${message}`, ...args);
  }
  
  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    console.log(`${colors.gray}[${this.formatTime()}] DEBUG ${message}`, ...args);
  }
  
  success(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    console.log(`${colors.gray}[${this.formatTime()}]${colors.reset} ${colors.green}✓${colors.reset} ${message}`, ...args);
  }
}

export const logger = new Logger(process.env.LOG_LEVEL as LogLevel || 'info');
export default logger;
