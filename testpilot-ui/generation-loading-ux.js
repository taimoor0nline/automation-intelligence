(function(){
  if(window.__aiTestPilotGenerationLoadingUx)return;
  window.__aiTestPilotGenerationLoadingUx=true;

  const style=document.createElement('style');
  style.id='generationLoadingUxStyles';
  style.textContent=`
    /* Generation mode is visual only: no observer/render loop is introduced here. */
    body.generation-active #reviewFilterShell,
    body.generation-active .review-filter-shell,
    body.generation-active [data-review-filter-bar]{display:none!important}

    body.generation-active #cases{
      min-height:300px!important;
      max-height:none!important;
      overflow:visible!important;
      padding:14px 16px 20px!important;
      background:linear-gradient(180deg,#fbfcff 0%,#f8faff 100%);
    }

    body.generation-active #cases>.empty{
      position:relative;
      min-height:250px;
      padding:62px 24px 28px!important;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:flex-start;
      gap:13px;
      color:#667085!important;
      border:1px solid #e6eaf2;
      border-radius:14px;
      background:#fff;
      text-align:center;
      font-size:0!important;
      box-shadow:0 8px 24px rgba(15,23,42,.035);
    }

    body.generation-active #cases>.empty:before{
      content:'Preparing your AI test suite';
      display:block;
      color:#172033;
      font-size:13px;
      font-weight:850;
      letter-spacing:.01em;
    }

    body.generation-active #cases>.empty:after{
      content:'Discovering the journey, generating scenarios and preparing them for human review.';
      display:block;
      max-width:390px;
      color:#667085;
      font-size:11px;
      line-height:1.55;
    }

    body.generation-active #cases>.empty{
      background-image:
        linear-gradient(90deg,#eef2f7 0%,#f8fafc 45%,#eef2f7 90%),
        linear-gradient(90deg,#eef2f7 0%,#f8fafc 45%,#eef2f7 90%),
        linear-gradient(90deg,#eef2f7 0%,#f8fafc 45%,#eef2f7 90%);
      background-repeat:no-repeat;
      background-size:82% 12px,68% 12px,75% 12px;
      background-position:center 156px,center 184px,center 212px;
      animation:generationSkeletonPulse 1.5s ease-in-out infinite;
    }

    @keyframes generationSkeletonPulse{
      0%,100%{background-color:#fff;opacity:1}
      50%{background-color:#fcfdff;opacity:.88}
    }

    body.generation-active .generation-case-preview{
      position:relative;
      margin:0 0 9px;
      padding:13px 14px 13px 17px!important;
      border:1px solid #e4e9f2!important;
      border-radius:11px;
      background:#fff!important;
      box-shadow:0 4px 14px rgba(15,23,42,.025);
      animation:generationCaseIn .18s ease-out both;
    }

    body.generation-active .generation-case-preview:before{
      content:'';
      position:absolute;
      left:0;
      top:10px;
      bottom:10px;
      width:3px;
      border-radius:0 3px 3px 0;
      background:#4465ff;
    }

    body.generation-active .generation-case-preview-title{
      font-size:11.7px!important;
      line-height:1.4;
      color:#172033!important;
    }

    body.generation-active .generation-case-preview-meta{margin-top:7px!important}
    body.generation-active .generation-case-preview-meta span{
      background:#f4f6fa!important;
      border:1px solid #edf0f5;
      color:#526077!important;
      font-size:9px!important;
      letter-spacing:.015em;
    }
    body.generation-active .generation-case-preview-meta .pending{
      background:#eef3ff!important;
      border-color:#dce5ff!important;
      color:#3155c8!important;
    }

    body.generation-active #caseSubtitle{
      color:#3155c8!important;
      font-weight:700;
    }

    /* Review actions are intentionally unavailable until generation finishes. */
    body.generation-active #runBtn{opacity:.45!important;pointer-events:none!important}
    body.generation-active #exportExcelBtn,
    body.generation-active [data-export-excel],
    body.generation-active #addTestCaseBtn,
    body.generation-active [data-add-test-case]{opacity:.4!important;pointer-events:none!important}

    @keyframes generationCaseIn{
      from{opacity:0;transform:translateY(3px)}
      to{opacity:1;transform:translateY(0)}
    }

    @media(max-width:760px){
      body.generation-active #cases{padding:10px!important;min-height:260px!important}
      body.generation-active #cases>.empty{min-height:220px;padding-left:16px!important;padding-right:16px!important}
    }

    @media(prefers-reduced-motion:reduce){
      body.generation-active #cases>.empty,
      body.generation-active .generation-case-preview{animation:none!important}
    }
  `;
  document.head.appendChild(style);
})();
