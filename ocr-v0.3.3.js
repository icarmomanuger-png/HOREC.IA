/* HOREC A.I. 0.3.3 — OCR/parser improvement layer */
(function(){
  const oldPreprocess = window.preprocess;

  function norm(s){
    return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
      .toLowerCase().replace(/[^a-z0-9]+/g,"");
  }
  function moneyToNumber(s){
    let x=String(s||"").replace(/\s/g,"");
    if(x.includes(",")) x=x.replace(/\./g,"").replace(",",".");
    else if((x.match(/\./g)||[]).length>1) x=x.replace(/\./g,"");
    return parseFloat(x)||0;
  }
  function moneyCandidates(text){
    const out=[], re=/\b\d{1,6}(?:[\s.]\d{3})*[.,]\d{2}\b/g;
    for(const m of String(text||"").matchAll(re)){
      const n=moneyToNumber(m[0]);
      if(n>0 && n<100000) out.push({raw:m[0],n,index:m.index});
    }
    return out;
  }
  function extractBestTotal(text){
    const labelled=[...String(text||"").matchAll(/(?:total|a\s*pagar|valor\s*total)\s*[:\-]?\s*(\d{1,6}(?:[\s.]\d{3})*[.,]\d{2})/ig)]
      .map(m=>moneyToNumber(m[1])).filter(n=>n>0);
    if(labelled.length) return labelled[labelled.length-1];
    const c=moneyCandidates(text); let best=null;
    for(const a of c) for(const b of c){
      if(a===b || a.n<=b.n) continue;
      const ratio=a.n/b.n, score=Math.abs(ratio-1.23);
      if(score<0.012 && (!best || score<best.score)) best={n:a.n,score};
    }
    return best ? best.n : (c.length ? Math.max(...c.map(x=>x.n)) : 0);
  }
  function extractDate(text){
    const t=String(text||"");
    const iso=t.match(/\b(20\d{2})[-.](\d{1,2})[-.](\d{1,2})\b/);
    if(iso) return iso[0].replace(/\./g,"-");
    const euro=t.match(/\b\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}\b/);
    return euro ? euro[0] : new Date().toLocaleDateString("pt-PT");
  }
  function extractInvoiceNumber(text){
    const t=String(text||"");
    const patterns=[
      /\bFN\s*[:#-]?\s*(\d{1,4}\s*\/\s*\d{5,12})\b/i,
      /\bF[NM]\s*[:#-]?\s*(\d{1,4}\s*\/\s*\d{5,12})\b/i,
      /\b(?:n(?:\.º|º|o)?\s*(?:fatura|factura))\s*[:#-]?\s*([A-Z0-9][A-Z0-9\/.-]{3,20})\b/i
    ];
    for(let i=0;i<patterns.length;i++){
      const m=t.match(patterns[i]);
      if(m) return i<2 ? "FN "+m[1].replace(/\s/g,"") : m[1];
    }
    return "";
  }
  function extractSupplier(text){
    const lines=String(text||"").split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
    for(const line of lines){
      const n=norm(line);
      if(n.includes("europastry")) return "Europastry Portugal, S.A.";
      if(/\b(makro|recheio|lactogal|nobre|continente|pingo doce|auchan|metro|delta|sumol|transgourmet|garcias)\b/i.test(line)) return line;
    }
    const stop=/(fatura|factura|tal[aã]o|recibo|data|hora|nif|vat|total|subtotal|cliente|morada|telefone|www\.|http|atcud)/i;
    return lines.slice(0,10).find(x=>x.length>=4&&x.length<=70&&!stop.test(x)&&/[A-Za-zÀ-ÿ]/.test(x)) || lines[0] || "Por confirmar";
  }
  function cleanOCR(text){
    return String(text||"").replace(/\r/g,"").split("\n")
      .map(x=>x.replace(/[ \t]+/g," ").trim()).filter(x=>x.length>1)
      .filter((x,i,a)=>a.findIndex(y=>norm(y)===norm(x))===i).join("\n");
  }
  function makeCrop(src,y0,y1){
    return new Promise((resolve,reject)=>{
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement("canvas");
        c.width=img.naturalWidth;
        c.height=Math.max(1,Math.round(img.naturalHeight*(y1-y0)));
        const ctx=c.getContext("2d");
        ctx.drawImage(img,0,Math.round(img.naturalHeight*y0),img.naturalWidth,c.height,0,0,c.width,c.height);
        resolve(c.toDataURL("image/jpeg",.94));
      };
      img.onerror=reject; img.src=src;
    });
  }
  async function pass(src,psm,logger){
    const worker=await Tesseract.createWorker("por+eng",1,{logger});
    try{
      await worker.setParameters({tessedit_pageseg_mode:String(psm),preserve_interword_spaces:"1",user_defined_dpi:"300"});
      const out=await worker.recognize(src);
      return out.data.text||"";
    } finally { await worker.terminate(); }
  }

  window.ocr=async function(src){
    try{
      const status=document.getElementById("status"),bar=document.getElementById("bar");
      status.textContent="A preparar imagem para OCR…"; bar.style.width="8%";
      const prep=oldPreprocess ? await oldPreprocess(src) : src;
      const logger=m=>{
        if(m.status) status.textContent=m.status;
        if(typeof m.progress==="number") bar.style.width=Math.min(95,8+m.progress*22)+"%";
      };
      const results=[];
      results.push(await pass(prep,3,logger));
      results.push(await pass(prep,6,logger));
      results.push(await pass(prep,11,logger));
      results.push(await pass(await makeCrop(prep,0,.42),6,logger));
      results.push(await pass(await makeCrop(prep,.35,.82),6,logger));
      const text=cleanOCR(results.join("\n"));
      bar.style.width="100%";
      window.reviewData(text||"OCR não encontrou texto suficiente. Tenta uma fotografia mais aproximada e bem iluminada.");
    }catch(e){
      console.error(e);
      window.reviewData("OCR indisponível. Preenche os campos manualmente.");
    }
  };

  window.reviewData=function(t){
    document.getElementById("processing").style.display="none";
    document.getElementById("review").style.display="block";
    for(let i=1;i<=4;i++) document.getElementById("st"+i).classList.toggle("on",i===3);
    const text=cleanOCR(t);
    document.getElementById("text").value=text;
    document.getElementById("supplier").value=extractSupplier(text);
    document.getElementById("number").value=extractInvoiceNumber(text);
    document.getElementById("date").value=extractDate(text);
    const total=extractBestTotal(text);
    document.getElementById("total").value=total ? total.toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2}) : "";
  };
})();
