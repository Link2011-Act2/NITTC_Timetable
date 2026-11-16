import { readFile } from 'node:fs/promises';
import { parseSktjf } from '../lib/validator.js';

if(process.argv.length<3){console.error('Usage: node bin/validate.mjs FILE...');process.exitCode=2;}
for(const path of process.argv.slice(2)){
  try{parseSktjf(await readFile(path));console.log(`${path}: valid`);}
  catch(error){console.error(`${path}: ${error.message}`);process.exitCode=1;}
}
