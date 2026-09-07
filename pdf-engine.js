/* CSM WYVERN Offline PDF Text Engine
 * Lightweight, dependency-free PDF text extractor for common text-based PDFs.
 * No CDN, no network, no external libraries. Uses browser DecompressionStream for FlateDecode.
 * Scanned/image-only PDFs require OCR and are reported as such.
 */
(function(global){
  const te=new TextDecoder('latin1');
  function bytesToString(u8){return te.decode(u8);}
  function latin1ToBytes(s){const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i)&255;return a;}
  function unescapeLiteral(s){let out='';for(let i=0;i<s.length;i++){let c=s[i];if(c!=='\\'){out+=c;continue;}if(++i>=s.length)break;c=s[i];if(c==='n')out+='\n';else if(c==='r')out+='\r';else if(c==='t')out+='\t';else if(c==='b')out+='\b';else if(c==='f')out+='\f';else if(c==='('||c===')'||c==='\\')out+=c;else if(c==='\n'){}else if(c==='\r'){if(s[i+1]==='\n')i++;}else if(/[0-7]/.test(c)){let oct=c;while(oct.length<3&&/[0-7]/.test(s[i+1]||''))oct+=s[++i];out+=String.fromCharCode(parseInt(oct,8));}else out+=c;}return out;}
  function hexDecode(s){s=s.replace(/\s+/g,'');if(s.length%2)s+='0';const a=new Uint8Array(s.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(s.slice(i*2,i*2+2),16);return bytesToString(a);}
  function decodeName(s){return s.replace(/#([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));}
  function parseTokens(s){
    const t=[];let i=0,n=s.length;
    while(i<n){while(i<n&&/[\s\x00]/.test(s[i]))i++;if(i>=n)break;let c=s[i];
      if(c==='%'){while(i<n&&s[i]!=="\n"&&s[i]!=="\r")i++;continue;}
      if(c==='('){let j=++i,depth=1,out='';while(i<n&&depth){let ch=s[i++];if(ch==='\\'){if(i<n)out+='\\'+s[i++];}else if(ch==='('){depth++;out+=ch;}else if(ch===')'){depth--;if(depth)out+=ch;}else out+=ch;}t.push({type:'str',v:unescapeLiteral(out)});continue;}
      if(c==='<'){if(s[i+1]==='<'){t.push({type:'op',v:'<<'});i+=2;continue;}let j=++i;while(i<n&&s[i]!=='>' )i++;t.push({type:'str',v:hexDecode(s.slice(j,i))});i++;continue;}
      if(c==='['){t.push({type:'arr',v:parseTokens(s.slice(i+1))});let depth=1;i++;while(i<n&&depth){if(s[i]==='[')depth++;else if(s[i]===']')depth--;i++;}continue;}
      if(c===']'){t.push({type:'op',v:']'});i++;continue;}
      if(c==='/'){let j=++i;while(i<n&&!/[\s\[\]()<>\/]/.test(s[i]))i++;t.push({type:'name',v:decodeName(s.slice(j,i))});continue;}
      let j=i;while(i<n&&!/[\s\[\]()<>\/]/.test(s[i]))i++;let v=s.slice(j,i);t.push({type:/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v)?'num':'op',v});
    }return t;
  }
  async function inflate(u8){
    if(!global.DecompressionStream)throw new Error('This browser does not support built-in PDF Flate decompression. Please use a current Chrome/Edge/Firefox/Safari.');
    const ds=new DecompressionStream('deflate');const ab=await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();return new Uint8Array(ab);
  }
  function asciiHex(u8){let s=bytesToString(u8).replace(/[^0-9A-Fa-f]/g,'');if(s.length%2)s+='0';return latin1ToBytes(hexDecode(s));}
  async function decodeStream(raw,dict){
    let u8=latin1ToBytes(raw), filter=(dict.match(/\/Filter\s*(\[[^\]]+\]|\/\w+)/)||[])[1]||'';
    if(/FlateDecode/.test(filter))u8=await inflate(u8); else if(/ASCIIHexDecode/.test(filter))u8=asciiHex(u8);
    return bytesToString(u8);
  }
  function extractTextOps(content){
    const tok=parseTokens(content), out=[];let stack=[];let x=0,y=0,fontSize=12;
    const emit=(text)=>{text=text.replace(/\u0000/g,'').trim();if(!text)return;out.push({text,x,y});x+=Math.max(3,text.length*fontSize*0.45);};
    for(let i=0;i<tok.length;i++){
      const q=tok[i]; if(q.type!=='op'){stack.push(q);continue;} const op=q.v;
      if(op==='Tm'&&stack.length>=6){x=Number(stack[4].v)||0;y=Number(stack[5].v)||0;stack=[];continue;}
      if((op==='Td'||op==='TD')&&stack.length>=2){x+=(Number(stack[0].v)||0);y+=(Number(stack[1].v)||0);stack=[];continue;}
      if(op==='T*'){y-=fontSize;stack=[];continue;}
      if(op==='Tf'&&stack.length>=2){fontSize=Number(stack[1].v)||fontSize;stack=[];continue;}
      if(op==='Tj'||op==="'"){let a=stack.findLast?.(z=>z.type==='str')||[...stack].reverse().find(z=>z.type==='str');if(a)emit(a.v);stack=[];continue;}
      if(op==='"'){let a=[...stack].reverse().find(z=>z.type==='str');if(a)emit(a.v);stack=[];continue;}
      if(op==='TJ'){let a=[...stack].reverse().find(z=>z.type==='arr');if(a&&a.v){for(const z of a.v)if(z.type==='str')emit(z.v);}stack=[];continue;}
      if(op==='BT'||op==='ET'||op==='q'||op==='Q'||op==='cm'){stack=[];continue;}
      if(op==='Td'||op==='Tj'||op==='TJ'||op==='Tm'||op==='Tf'||op==='TD')stack=[];
      else if(stack.length>12)stack=[];
    }
    return out;
  }
  function objectStreams(pdf){
    const s=bytesToString(pdf), re=/((?:\d+\s+\d+\s+obj)\s*(<<[\s\S]*?>>)\s*stream\r?\n)([\s\S]*?)\r?\nendstream/g, a=[];let m;
    while((m=re.exec(s))){const header=m[1],dict=m[2],raw=m[3];a.push({dict,raw});}return a;
  }
  async function extract(arrayBuffer,onProgress){
    const u8=new Uint8Array(arrayBuffer), objs=objectStreams(u8), pages=[], all=[];let i=0;
    for(const o of objs){i++;if(onProgress)onProgress(i,objs.length);if(!/(BT|Tj|TJ|Tf|Tm|Td|TD)/.test(o.raw))continue;try{const content=await decodeStream(o.raw,o.dict);if(!/(BT|Tj|TJ)/.test(content))continue;const items=extractTextOps(content);if(items.length)all.push(items);}catch(e){/* ignore unsupported stream */}}
    // Best-effort page grouping. Common PDFs store page content streams in document order.
    let pageNo=1;for(const items of all){items.sort((a,b)=>Math.abs(a.y-b.y)>3?b.y-a.y:a.x-b.x);const lines=[];for(const it of items){let last=lines[lines.length-1];if(!last||Math.abs(last.y-it.y)>3)lines.push({y:it.y,cells:[it]});else last.cells.push(it);}pages.push({page:pageNo++,lines:lines.map(l=>l.cells.map(c=>c.text).join(' | '))});}
    const rows=[];for(const p of pages)for(const line of p.lines)if(line.trim())rows.push([String(p.page),line]);
    return {numPages:pages.length,rows,items:all.flat()};
  }
  global.CSMOfflinePDF={extract,version:'1.0-offline'};
})(window);
