import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
await p.goto('http://localhost:3001/', { waitUntil: 'networkidle0' });
console.log('OK title:', await p.title());
await b.close();
