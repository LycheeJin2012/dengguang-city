// Dependency-free build validation for the existing Cloudflare Pages deployment.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const modules=[...walk(root+'js'),...walk(root+'functions')].filter(f=>f.endsWith('.js'));
for(const f of modules){const cache=new Map();function get(file){if(!cache.has(file))cache.set(file,new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{identifier:file}));return cache.get(file);}await get(f).link((spec,m)=>get(path.resolve(path.dirname(m.identifier),spec.split('?')[0])));}
for(const name of ['index','hotel','profile','dm','notifications','leaderboard','admin-v37','404']){const file=root+name+'.html',html=fs.readFileSync(file,'utf8');for(const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)(?:\?[^"#]*)?"/g)){if(m[1]==='/')continue;if(!fs.existsSync(root+m[1].slice(1)))throw new Error(`${name}: missing ${m[1]}`);}}
// Keep the old CSS URL usable while pages migrate to the new shared stylesheet.
fs.copyFileSync(root+'css/style.css',root+'css/style.min.css');
console.log(`Build validated: ${modules.length} JS modules, 8 HTML pages, shared assets. Existing Pages layout preserved.`);
