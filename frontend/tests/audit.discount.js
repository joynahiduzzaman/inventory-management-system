/**
 * Discount ৳/% control audit.
 *
 *   node tests/audit.discount.js [baseUrl]
 *
 * This is the control most likely to lose real money through a slip: typing 15
 * meaning ৳15 while the toggle sits on % takes ৳394 off a ৳2,627 sale, and both
 * are plausible discounts on a receipt. So this does not merely check that the
 * toggle works — it walks the slip itself, and asserts the mistake is visible
 * on screen before Complete Sale can be pressed.
 */
const puppeteer=require('C:/Users/skjoy/AppData/Local/Temp/claude/c--Users-skjoy-Desktop-inventory-system-v2-FINAL/97bcd6f8-2a0a-4962-9ff3-d1f2971bdecb/scratchpad/node_modules/puppeteer-core'); const fs=require('fs');
const BASE=process.argv[2] || process.env.POS_BASE || 'http://localhost:3000';
const env=Object.fromEntries(fs.readFileSync('c:/Users/skjoy/Desktop/inventory-system-v2-FINAL/backend/.env','utf8')
 .split(/\r?\n/).filter(l=>l.includes('=')&&!l.trim().startsWith('#')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const results=[];
const check=(n,ok,d='')=>{results.push({n,ok});console.log(`  ${ok?'PASS':'FAIL'} | ${n}${d?'  — '+d:''}`)};
(async()=>{
 const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
 const p=await b.newPage(); await p.setViewport({width:1440,height:900});
 await p.goto(BASE+'/login',{waitUntil:'networkidle2',timeout:120000});
 await p.type('input[type=email]',env.SEED_ADMIN_EMAIL); await p.type('input[type=password]',env.SEED_ADMIN_PASSWORD);
 await p.click('button[type=submit]'); await p.waitForFunction(()=>!location.pathname.startsWith('/login'),{timeout:60000});
 await p.goto(BASE+'/pos',{waitUntil:'networkidle2',timeout:90000});
 await p.waitForSelector('.pos-tile',{timeout:45000}); await new Promise(r=>setTimeout(r,1800));

 // Build a cart worth a few thousand taka, like the scenario in the brief.
 await p.evaluate(()=>{const t=[...document.querySelectorAll('.pos-tile:not([disabled])')].slice(0,6); t.forEach(x=>{for(let i=0;i<4;i++)x.click();});});
 await new Promise(r=>setTimeout(r,1600));
 const read=()=>p.evaluate(()=>({
   subtotal: document.querySelector('.pos-sub-value')?.innerText,
   total:    document.querySelector('.pos-total-amount')?.innerText,
   resolved: document.querySelector('.pos-disc-resolved')?.innerText || null,
   modes:    [...document.querySelectorAll('.pos-disc-mode')].map(x=>x.innerText.trim()+(x.getAttribute('aria-pressed')==='true'?'*':'')),
   checkoutDisabled: !!document.querySelector('#pos-checkout')?.disabled,
 }));
 const type=async(v)=>{await p.evaluate(()=>{const i=document.getElementById('pos-discount');i.focus();i.select();});
   await p.keyboard.down('Control');await p.keyboard.press('KeyA');await p.keyboard.up('Control');
   await p.keyboard.type(String(v),{delay:30}); await new Promise(r=>setTimeout(r,700));};
 const mode=async(sym)=>{await p.evaluate((s)=>{[...document.querySelectorAll('.pos-disc-mode')].find(x=>x.innerText.trim()===s).click();},sym);
   await new Promise(r=>setTimeout(r,600));};

 let s=await read();
 console.log('  cart subtotal:', s.subtotal, '| modes:', s.modes.join(' '));
 check('taka is the default mode', s.modes[0].endsWith('*') && !s.modes[1].endsWith('*'), s.modes.join(' '));
 check('no resolved line before anything is typed', s.resolved===null);

 // ── flat ৳15, the intended action
 await type(15); s=await read();
 const subtotalNum=parseFloat(s.subtotal.replace(/[^\d.]/g,''));
 const totalFlat=parseFloat(s.total.replace(/[^\d.]/g,''));
 check('৳15 flat takes 15 off the total', Math.abs(subtotalNum-totalFlat-15)<0.02, `${s.subtotal} -> ${s.total}`);
 check('  and states the equivalent percentage', !!s.resolved && /%/.test(s.resolved), s.resolved);

 // ── the slip: same keystrokes, wrong mode
 await mode('%'); s=await read();
 check('switching mode clears the field so 15 is not silently reinterpreted',
       await p.evaluate(()=>document.getElementById('pos-discount').value)==='0',
       'field='+await p.evaluate(()=>document.getElementById('pos-discount').value));
 await type(15); s=await read();
 const totalPct=parseFloat(s.total.replace(/[^\d.]/g,''));
 check('15% takes ~15% off, not ৳15', Math.abs((subtotalNum-totalPct)-subtotalNum*0.15)<0.05,
       `subtotal=${s.subtotal} total=${s.total} off=${(subtotalNum-totalPct).toFixed(2)}`);
 check('  the resolved TAKA amount is shown live — the slip is visible', !!s.resolved && /৳/.test(s.resolved), s.resolved);
 check('  the total updated immediately, before Complete Sale', totalPct!==totalFlat, `flat=${totalFlat} pct=${totalPct}`);
 check('  the active mode is % and it is the only one pressed',
       s.modes[1].endsWith('*') && !s.modes[0].endsWith('*'), s.modes.join(' '));

 // ── out of range
 await type(150); s=await read();
 check('a rate above 100% blocks Complete Sale', s.checkoutDisabled, 'resolved='+s.resolved);
 const err=await p.evaluate(()=>document.querySelector('.pos-notice.is-danger')?.innerText||null);
 check('  and says so in words', !!err, err);

 await type(50); s=await read();
 check('back in range, Complete Sale is enabled again', !s.checkoutDisabled, s.resolved);

 // ── the sale actually lands with mode + rate
 await p.evaluate(()=>document.getElementById('pos-checkout').click());
 await new Promise(r=>setTimeout(r,6000));
 const inv=await p.evaluate(()=>{const m=document.querySelector('.modal-body');return m?m.innerText.replace(/\s+/g,' '):null;});
 check('the invoice shows the percentage that was agreed', !!inv && /\(50%\)/.test(inv),
       inv?inv.slice(inv.indexOf('ছাড়')>=0?inv.indexOf('ছাড়')-40:0).slice(0,110):'no modal');

 await b.close();
 const f=results.filter(r=>!r.ok);
 console.log(`\n===== ${results.length-f.length}/${results.length} passed, ${f.length} FAILED =====`);
 process.exit(f.length?1:0);
})().catch(e=>{console.error('HARNESS ERROR',e.message);process.exit(1)});
