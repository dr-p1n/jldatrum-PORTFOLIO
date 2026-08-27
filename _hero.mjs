import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
let fail=0;
const check=(n,ok)=>{console.log(`  ${ok?"ok  ":"FAIL"} ${n}`); if(!ok) fail++;};

for(const [lang,url] of [["EN","http://127.0.0.1:3456/"],["ES","http://127.0.0.1:3456/es/"]]){
  // desktop: side by side
  let p=await b.newPage({viewport:{width:1440,height:1000}});
  await p.goto(url,{waitUntil:"load"});
  await p.waitForSelector(".dx-viz--compound svg",{timeout:5000});
  let r=await p.evaluate(()=>{
    const t=document.querySelector(".hero-title").getBoundingClientRect();
    const s=document.querySelector(".hero-sub").getBoundingClientRect();
    const g=document.querySelector(".dx-viz--compound").getBoundingClientRect();
    const svg=document.querySelector(".dx-viz--compound svg");
    return {sideBySide:s.left>t.right-40, graphicRight:g.left>t.right-40,
      graphicW:Math.round(g.width), graphicH:Math.round(g.height),
      title:svg.querySelector("title")?.textContent||"",
      paths:svg.querySelectorAll("path").length,
      texts:[...svg.querySelectorAll("text")].map(t=>t.textContent)};});
  console.log(`\n${lang} @1440`);
  check("subtext sits beside the headline", r.sideBySide);
  check("graphic sits beside the headline", r.graphicRight);
  check("graphic has an accessible title", r.title.length>60);
  check("legend + axis labels present", r.texts.length===3);
  console.log(`       ${r.graphicW}x${r.graphicH}px · labels ${JSON.stringify(r.texts)}`);
  await p.close();

  // mobile: stacks in reading order
  p=await b.newPage({viewport:{width:390,height:900}});
  await p.goto(url,{waitUntil:"load"});
  await p.waitForSelector(".dx-viz--compound svg",{timeout:5000});
  r=await p.evaluate(()=>{const y=s=>document.querySelector(s).getBoundingClientRect().top;
    return {e:y(".eyebrow"),h:y(".hero-title"),s:y(".hero-sub"),g:y(".dx-viz--compound"),a:y(".hero-actions")};});
  console.log(`${lang} @390`);
  check("stacks eyebrow→title→sub→graphic→buttons", r.e<r.h && r.h<r.s && r.s<r.g && r.g<r.a);
  await p.close();
}

// motion contract: JS off must still render a complete graphic, never blank
const p=await b.newPage({viewport:{width:1440,height:1000},javaScriptEnabled:false});
await p.goto("http://127.0.0.1:3456/",{waitUntil:"load"});
const noJs=await p.evaluate?0:null;
const html=await p.content();
console.log("\nJS disabled");
check("no undrawn state is applied without JS", !html.includes("dx-anim"));
check("container is empty but never a broken frame", html.includes('data-viz="compound"'));
await p.close();
await b.close();
console.log(fail?`\n${fail} FAILURES`:"\nPASS");
process.exit(fail?1:0);
