// Supported Cypress-compatible human authoring. Parse literals only; never eval,
// execute, or accept arbitrary callbacks from browser-submitted source.
const ACTIONS = Object.freeze({
  clear:'CLEAR',click:'CLICK',dblclick:'DBLCLICK',rightclick:'RIGHTCLICK',
  focus:'FOCUS',blur:'BLUR',select:'SELECT',check:'CHECK',uncheck:'UNCHECK',
  submit:'SUBMIT',scrollIntoView:'SCROLL_INTO_VIEW',type:'TYPE',
});
const WITH_VALUE = new Set(['type','select']);
const ASSERTIONS = Object.freeze({
  'be.visible':'ASSERT_VISIBLE',
  'not.be.visible':'ASSERT_HIDDEN',
  'exist':'ASSERT_EXISTS',
  'not.exist':'ASSERT_NOT_EXISTS',
  'be.enabled':'ASSERT_ENABLED',
  'be.disabled':'ASSERT_DISABLED',
  'be.checked':'ASSERT_CHECKED',
  'not.be.checked':'ASSERT_UNCHECKED',
  'have.value':'ASSERT_VALUE_EQUALS',
  'not.have.value':'ASSERT_VALUE_NOT_EMPTY',
  'contain.text':'ASSERT_TEXT_CONTAINS',
  'include.text':'ASSERT_TEXT_CONTAINS',
  'not.contain.text':'ASSERT_TEXT_NOT_CONTAINS',
  'have.text':'ASSERT_TEXT_EQUALS',
});
function failure(line, detail) {
  const error = new Error('Cypress script line '+line+': '+detail);
  error.code = 'MANUAL_AUTOMATION_SCRIPT_INVALID';
  throw error;
}
function splitArgs(text,line) {
  if (!text.trim()) return [];
  const raw=[];let start=0,quote='',escaped=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quote) {
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==="'"||ch==='"'){quote=ch;continue;}
    if(ch===','){raw.push(text.slice(start,i));start=i+1;}
  }
  if(quote)failure(line,'Unterminated quoted argument.');
  raw.push(text.slice(start));
  return raw.map(arg=>{
    const value=arg.trim(),q=value[0];
    if((q!=="'"&&q!=='"')||value.at(-1)!==q||value.length<2)failure(line,'Use quoted string literal arguments only; expressions, callbacks and variables are not supported.');
    const middle=value.slice(1,-1);let result='';
    for(let i=0;i<middle.length;i++){
      const c=middle[i];
      if(c!=='\\'){if(c===q)failure(line,'Escape quotes inside string literals.');result+=c;continue;}
      if(++i>=middle.length)failure(line,'Incomplete string escape.');
      const escaped=middle[i], map={n:'\n',r:'\r',t:'\t','\\':'\\',"'":"'",'"':'"'};
      if(!Object.prototype.hasOwnProperty.call(map,escaped))failure(line,'Unsupported string escape: '+escaped);
      result+=map[escaped];
    }
    return result;
  });
}
function readCall(source,start,line) {
  const head=source.slice(start).match(/^([A-Za-z]\w*)\(/);
  if(!head)failure(line,'Use supported Cypress calls, such as cy.get("#email").type("x").');
  const name=head[1];let at=start+head[0].length,quote='',escaped=false;
  const begin=at;
  for(;at<source.length;at++){
    const ch=source[at];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==="'"||ch==='"'){quote=ch;continue;}
    if(ch==='(')failure(line,'Nested expressions and callbacks are not supported.');
    if(ch===')')return {name,args:splitArgs(source.slice(begin,at),line),next:at+1};
  }
  failure(line,'Missing closing parenthesis.');
}
function targetFor(selector,path,registry,line) {
  let found=(registry.elements||[]).filter(item=>item.elementRef===selector||item.selector===selector);
  if(path)found=found.filter(item=>String(item.path||'')===path);
  if(!found.length)failure(line,'Selector '+JSON.stringify(selector)+' is not a discovered control'+(path?' on '+path:'')+'.');
  if(found.length!==1)failure(line,'Selector '+JSON.stringify(selector)+' is ambiguous; use an exact discovered elementRef.');
  return found[0].elementRef;
}
function pagePath(url,registry,line) {
  if(url.startsWith('/'))return url;
  let parsed;
  try{parsed=new URL(url);}catch{failure(line,'cy.visit requires a discovered same-origin path or URL.');}
  const known=(registry.pages||[]).some(page=>{
    try{return new URL(page.finalUrl||page.url).origin===parsed.origin;}catch{return false;}
  });
  if(!known)failure(line,'cy.visit cannot navigate to an undiscovered origin.');
  return parsed.pathname+parsed.search;
}
function elementAssertion(method,args,elementRef,line) {
  if(method!=='should'&&method!=='and')failure(line,'Only .should() and .and() can follow an assertion.');
  const [name,value]=args;
  if(typeof name!=='string')failure(line,'An assertion name is required.');
  if(name==='match'&&value===':invalid')return {operation:'ASSERT_INVALID',elementRef};
  if(name==='match'&&value===':valid')return {operation:'ASSERT_VALID',elementRef};
  if(name==='have.attr'&&value==='required')return {operation:'ASSERT_REQUIRED',elementRef};
  if(name==='not.have.attr'&&value==='required')return {operation:'ASSERT_OPTIONAL',elementRef};
  if(name==='have.value'&&value==='')return {operation:'ASSERT_VALUE_EMPTY',elementRef};
  if(name==='not.have.value'&&value==='')return {operation:'ASSERT_VALUE_NOT_EMPTY',elementRef};
  if(name==='have.text'&&value==='')return {operation:'ASSERT_TEXT_EMPTY',elementRef};
  const operation=ASSERTIONS[name];
  if(!operation)failure(line,'Unsupported Cypress assertion '+JSON.stringify(name)+'.');
  const takesValue=['have.value','have.text','contain.text','include.text','not.contain.text','not.have.value'].includes(name);
  if((takesValue&&args.length!==2)||(!takesValue&&args.length!==1))failure(line,'Incorrect arguments for '+JSON.stringify(name)+'.');
  return {operation,elementRef,...(takesValue?(name.includes('text')?{text:value}:{value}):{})};
}
function locationAssertion(kind,method,args,line) {
  if(method!=='should'&&method!=='and')failure(line,'A location check requires .should() or .and().');
  if(args.length!==2)failure(line,'Location assertions require a comparison and expected value.');
  const [comparison,value]=args;
  const eq=['eq','equal'].includes(comparison);
  const includes=['include','contain'].includes(comparison);
  if(!eq&&!includes)failure(line,'Use eq, equal, include or contain for location assertions.');
  if(kind==='pathname')return eq?{operation:'ASSERT_PATH_EQUALS',path:value}:{operation:'ASSERT_PATH_INCLUDES',fragment:value};
  return eq?{operation:'ASSERT_URL_EQUALS',url:value}:{operation:'ASSERT_URL_INCLUDES',fragment:value};
}
function parseCypressScript(script,registry={}) {
  if(typeof script!=='string'||script.length>14000)failure(1,'Script must be plain text of at most 14,000 characters.');
  const lines=script.split(/\r?\n/);
  if(lines.length>100)failure(100,'Limit the script to 100 lines.');
  const actions=[],assertions=[];
  let currentPath='',inAssertions=false;
  lines.forEach((raw,index)=>{
    const line=index+1,text=raw.trim();
    if(!text||text.startsWith('//'))return;
    if(!text.startsWith('cy.'))failure(line,'Use supported Cypress cy.* commands; describe/it, JavaScript and arbitrary callbacks are not allowed in this editor.');
    const code=text.endsWith(';')?text.slice(0,-1).trimEnd():text;
    const root=readCall(code,3,line);
    let at=root.next;
    const chain=[];
    while(at<code.length){
      if(code[at]!=='.')failure(line,'Unexpected text after Cypress command.');
      const method=readCall(code,at+1,line);
      chain.push(method);at=method.next;
    }
    if(root.name==='visit'){
      if(inAssertions||chain.length||root.args.length!==1)failure(line,'cy.visit takes one URL/path and cannot follow assertions.');
      const path=pagePath(root.args[0],registry,line);currentPath=path.split('?')[0]||'/';
      actions.push({operation:'NAVIGATE',path});return;
    }
    if(root.name==='reload'||root.name==='go'){
      if(inAssertions||chain.length)failure(line,'Navigation actions must precede assertions.');
      if(root.name==='reload'&&root.args.length===0)actions.push({operation:'RELOAD'});
      else if(root.name==='go'&&root.args.length===1&&['back','forward'].includes(root.args[0]))actions.push({operation:root.args[0]==='back'?'GO_BACK':'GO_FORWARD'});
      else failure(line,'Use cy.reload(), cy.go("back") or cy.go("forward").');
      return;
    }
    if(root.name==='url'||root.name==='location'){
      const kind=root.name==='url'?'url':root.args[0];
      if(root.name==='url'&&root.args.length||root.name==='location'&&(root.args.length!==1||kind!=='pathname'))failure(line,'Only cy.url() and cy.location("pathname") are supported.');
      if(!chain.length)failure(line,'A Cypress location check needs .should().');
      for(const item of chain){inAssertions=true;assertions.push(locationAssertion(kind,item.name,item.args,line));}
      return;
    }
    if(root.name!=='get'||root.args.length!==1||!root.args[0])failure(line,'Use cy.get("discovered selector") for element operations.');
    if(!chain.length)failure(line,'cy.get() needs an action or assertion.');
    const elementRef=targetFor(root.args[0],currentPath,registry,line);
    for(const item of chain){
      if(item.name==='should'||item.name==='and'){
        inAssertions=true;assertions.push(elementAssertion(item.name,item.args,elementRef,line));continue;
      }
      const operation=ACTIONS[item.name];
      if(!operation)failure(line,'Unsupported Cypress action '+item.name+'.');
      if(inAssertions)failure(line,'All actions must appear before the final assertions.');
      const hasValue=WITH_VALUE.has(item.name);
      if((hasValue&&item.args.length!==1)||(!hasValue&&item.args.length!==0))failure(line,'Incorrect arguments for '+item.name+'.');
      if(hasValue&&!item.args[0])failure(line,'Use .clear() for empty values.');
      actions.push(hasValue?{operation,elementRef,value:item.args[0]}:{operation,elementRef});
    }
  });
  if(!actions.length)failure(1,'At least one browser action is required.');
  if(!assertions.length)failure(lines.length||1,'At least one Cypress .should() assertion is required.');
  return {actions,assertions};
}
module.exports={parseCypressScript};
