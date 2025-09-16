import { existsSync } from 'fs';
console.log('wont have any changes: ', existsSync('nochange.txt'));