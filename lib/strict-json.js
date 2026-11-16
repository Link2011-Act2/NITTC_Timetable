/** Parse a bounded UTF-8 JSON object and reject duplicate keys at every nesting level. */
export function parseStrictJson(input, maxBytes) {
  const bytes=typeof input==='string'?Buffer.from(input,'utf8'):input;
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>maxBytes)throw new Error('JSONのサイズが正しくありません');
  let text;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch{throw new Error('JSONの文字コードが正しくありません');}
  // JSON.parse checks the full grammar. The following walk detects duplicate keys
  // (including escaped spellings) and enforces the limits used by the app.
  const result=JSON.parse(text);
  let pos=0,nodes=0;
  const space=()=>{while(pos<text.length&&' \n\r\t'.includes(text[pos]))pos++;};
  function string(){
    const start=pos++;
    while(pos<text.length){const c=text[pos++];if(c==='"')return JSON.parse(text.slice(start,pos));if(c==='\\')pos++;}
    throw new Error('JSONの文字列が正しくありません');
  }
  function value(depth){
    if(depth>32||++nodes>100_000)throw new Error('JSONの構造が大きすぎます');
    space();const c=text[pos];
    if(c==='{'){
      pos++;space();const keys=new Set();if(text[pos]==='}'){pos++;return;}
      while(true){space();const key=string();if(keys.has(key))throw new Error('JSONのキーが重複しています');keys.add(key);space();pos++;value(depth+1);space();if(text[pos++]==='}')return;}
    }
    if(c==='['){
      pos++;space();if(text[pos]===']'){pos++;return;}
      while(true){value(depth+1);space();if(text[pos++]===']')return;}
    }
    if(c==='"'){string();return;}
    while(pos<text.length&&!/[\s,\]}]/.test(text[pos]))pos++;
  }
  value(0);
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('JSONの形式が正しくありません');
  return result;
}
