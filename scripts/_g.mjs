import puppeteer from "puppeteer-core";
const b=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true,args:["--no-sandbox"]});
async function login(u){const ctx=await b.createBrowserContext();const p=await ctx.newPage();await p.setViewport({width:1300,height:880});
await p.goto("http://localhost:3000/login",{waitUntil:"networkidle2"});
await p.type('input[autocomplete="username"]',u);await p.type('input[type="password"]',"password");
await Promise.all([p.waitForNavigation({waitUntil:"networkidle2"}),p.click('button.btn-primary')]);
await new Promise(r=>setTimeout(r,1500));return p;}
const alice=await login("alice"), bob=await login("bob");
for(const p of [alice,bob]){await p.evaluate(()=>[...document.querySelectorAll("button")].find(x=>/Bob Martins|Alice Nguyen/.test(x.textContent))?.click());await new Promise(r=>setTimeout(r,1500));}
await alice.evaluate(()=>[...document.querySelectorAll('button[title="GIFs"]')][0]?.click());
await new Promise(r=>setTimeout(r,2500));
await alice.type('input[placeholder="Search GIPHY…"]',"hello");
await new Promise(r=>setTimeout(r,2500));
await alice.evaluate(()=>document.querySelector('.columns-3 button')?.click());
await new Promise(r=>setTimeout(r,2500));
const bobGifs=await bob.evaluate(()=>[...document.querySelectorAll('img')].filter(i=>i.src.includes('giphy.com')).map(i=>i.naturalWidth));
console.log("GIF imgs in bob's conversation:",JSON.stringify(bobGifs));
await bob.screenshot({path:".shot-gifmsg.png"});
await b.close();
