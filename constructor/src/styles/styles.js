// Constructor — estúdio claro, controles e bancada responsiva.
(function () {
  'use strict';
  const ctx=window._constructor;
  if(!ctx?.current())return;
  ctx.styles=`
    :host{
      all:initial;color-scheme:light;
      --accent:#EF6B35;--accent-strong:#B84419;--accent-soft:#FFF0E8;
      --text:#20262C;--muted:#5E6974;--line:#DAE0E5;--surface:#FFFFFF;--canvas:#F1F3F5;
      --green:#43846A;--green-soft:#EAF5EF;--warning:#865116;--warning-soft:#FFF5DF;
      --grid:#D8E0E6;--danger:#AB392D;--danger-soft:#FFF1EE;--on-accent:#20262C;--overlay:#20262C66;
    }
    :host([data-theme=dark]){
      color-scheme:dark;
      --accent:#F48350;--accent-strong:#FFB58E;--accent-soft:#382A23;
      --text:#EDF2F6;--muted:#ACB8C3;--line:#35424E;--surface:#1A232C;--canvas:#111A22;
      --green:#8ACBAC;--green-soft:#1C332A;--warning:#EABE78;--warning-soft:#342A1C;
      --grid:#2E414F;--danger:#F3A49B;--danger-soft:#392523;--overlay:#00000099;
    }
    *,*::before,*::after{box-sizing:border-box}
    [hidden]{display:none!important}
    button,input,select,textarea{font:inherit}
    button,summary{-webkit-tap-highlight-color:transparent}
    button{cursor:pointer}
    button:disabled{cursor:default;opacity:.46}
    input,select,textarea{min-width:0}
    button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #BA451C;outline-offset:3px}
    button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
    .shell{font:13px/1.5 'Constructor Manrope','Manrope','Segoe UI',Tahoma,sans-serif;color:var(--text)}
    .panel{
      width:var(--width,1440px);height:var(--height,860px);max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);
      display:flex;flex-direction:column;position:relative;overflow:hidden;
      background:var(--canvas);color:var(--text);border:1px solid var(--line);border-radius:12px;
      box-shadow:0 16px 56px #20262C26;text-align:left;font:13px/1.5 'Constructor Manrope','Manrope','Segoe UI',Tahoma,sans-serif;
      container-type:inline-size;isolation:isolate;
    }
    h1,h2,h3,.bench-preview-head>strong,.bench-empty>strong,.task-top strong{font-family:'Constructor Display','Bricolage Grotesque','Segoe UI',sans-serif}
    h1,h2,h3,p{margin:0}
    h2{font-size:19px;line-height:1.25;font-weight:750;letter-spacing:-.45px}
    h3{font-size:15px;line-height:1.35;font-weight:700;letter-spacing:-.2px}
    .header{display:grid;grid-template-columns:minmax(210px,1fr) auto minmax(210px,1fr);align-items:center;gap:20px;min-height:76px;padding:0 24px;background:var(--surface);border-bottom:1px solid var(--line);flex:none;touch-action:none;cursor:grab}
    .header:active{cursor:grabbing}
    .brand-lockup{display:flex;align-items:center;gap:12px;min-width:0}
    .mark{width:38px;height:38px;flex:none}
    .mark svg{display:block;width:100%;height:100%}
    .brand{min-width:0}
    .brand h1{font-size:27px;line-height:1.1;font-weight:800;letter-spacing:-1px}
    .brand p{font-size:10px;color:var(--muted);margin-top:3px}
    .tabs{display:flex;align-self:stretch;align-items:stretch;gap:20px;min-width:0}
    .tab{border:0;border-bottom:3px solid transparent;background:transparent;padding:3px 4px 0;color:var(--muted);font-weight:600;white-space:nowrap;font-size:13px;min-height:44px}
    .tab:hover{color:var(--text)}
    .tab[aria-selected=true]{border-bottom-color:var(--accent);color:var(--text);font-weight:800}
    .header-end{display:flex;justify-content:flex-end;align-items:center;gap:18px;min-width:0}
    .connection{display:flex;align-items:center;gap:8px;min-width:0;font-size:11px;color:var(--muted)}
    #connection-text{max-width:185px;line-height:1.35;overflow-wrap:anywhere}
    .dot{width:9px;height:9px;flex:none;border-radius:50%;background:#A88344}
    .connection.online .dot{background:var(--green)}
    .demo{font-size:10px;color:var(--accent-strong);background:var(--accent-soft);padding:3px 6px;border-radius:4px}
    .window-actions{display:flex;align-items:center;gap:4px;border-left:1px solid var(--line);padding-left:12px}
    .icon{border:1px solid transparent;background:transparent;color:var(--muted);padding:9px;min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;flex:none}
    .icon:hover{background:var(--canvas);color:var(--text)}
    #close-panel:hover{background:var(--danger-soft);color:var(--danger)}
    .body{flex:1;min-height:0;padding:24px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
    .body:has(#view-projects:not([hidden])){padding:0;overflow:hidden}
    .view{min-width:0}
    #view-settings{max-width:780px;margin:0 auto;padding-bottom:24px}
    #view-settings>h2{font-size:28px;margin-bottom:14px}
    .heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
    .hint{font-size:12px;line-height:1.6;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}
    .subtle{font-size:11px;line-height:1.6;color:var(--muted);margin-top:8px;overflow-wrap:anywhere}
    .muted{color:var(--muted)}
    .section{margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}
    .section:first-child{margin-top:0;padding-top:0;border-top:0}
    .row{display:flex;gap:12px;align-items:end}
    .row>*{flex:1;min-width:0}
    .row>.auto{flex:0 0 auto}
    .fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
    .fields.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    label{display:block;color:var(--muted);font-size:12px;font-weight:500}
    label input,label select,label textarea{margin-top:6px}
    .control{width:100%;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:10px 12px;color:var(--text);line-height:1.4;min-height:40px}
    .control::placeholder{color:var(--muted)}
    .control:focus{border-color:var(--accent)}
    textarea{resize:vertical;line-height:1.6!important;font-family:Consolas,monospace!important;font-size:12px!important}
    .check{display:flex;align-items:center;gap:9px;padding:5px 0}
    .check input{accent-color:var(--accent);margin:0;width:17px;height:17px;flex:none}
    .button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:6px;font-weight:650;padding:10px 14px;line-height:1.35;min-height:40px;text-decoration:none}
    .button:hover:not(:disabled){background:var(--canvas);border-color:#AEBAC4}
    .button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:800}
    .button.primary:hover:not(:disabled){background:#F58457;border-color:#F58457}
    .button.small{padding:8px 11px;font-size:12px;min-height:35px}
    .button.quiet{border-color:transparent;background:transparent;color:var(--muted)}
    .button.quiet:hover:not(:disabled){background:var(--canvas);border-color:transparent;color:var(--text)}
    .button.danger{color:var(--danger);border-color:var(--danger);background:var(--danger-soft)}
    .button.wide{width:100%}
    .actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}
    .actions>*{flex:1;min-width:0}
    .disclosure{margin-top:16px}
    .disclosure summary{cursor:pointer;color:var(--muted);font-weight:650;font-size:12px;padding:8px 0}
    .disclosure[open] summary{color:var(--accent-strong)}
    .disclosure .content{padding-top:10px}
    .empty{padding:22px 14px;border:1px dashed var(--line);border-radius:6px;color:var(--muted);text-align:center;font-size:12px;overflow-wrap:anywhere}

    /* Projetos: navegação por origem, prévia ampla e preparação progressiva. */
    .capture-form-slot{flex:none;max-height:245px;overflow:auto;padding:15px 22px;border-bottom:1px solid var(--line);background:var(--surface)}
    .capture-form-slot .section{border:0;padding:0;margin:0}.capture-form-slot h2{font-size:16px}.capture-form-slot .row{margin-top:8px!important}
    .inspector-inventory{margin:20px 0 12px}.inspector-inventory>summary,.bench-mount>summary{cursor:pointer;font-size:12px;font-weight:650;line-height:1.6;color:var(--text);padding:8px 0;overflow-wrap:anywhere}
    .inspector-inventory .inventory-title{display:none}.inspector-inventory .bench-summary{margin:8px 0 0}.bench-mount .origin{padding-top:9px}
    #buy-slot #buy{width:100%;margin:0 0 8px;font-size:12px;min-height:40px}
    .catalog-readiness{padding:10px 12px;border-left:2px solid var(--warning);background:var(--warning-soft);margin-top:12px}
    .catalog-readiness[data-ready=true]{background:var(--green-soft);border-left-color:var(--green)}
    .catalog-diagnostics{margin-top:12px}.catalog-diagnostics>summary{font-size:11px;cursor:pointer;color:var(--muted)}
    .workbench{height:100%;min-height:0;display:flex;flex-direction:column}
    .bench-grid{display:grid;grid-template-columns:250px minmax(0,1fr) 304px;flex:1;min-height:0}
    .bench-projects,.bench-inspector{min-width:0;padding:24px 22px;overscroll-behavior:contain;scrollbar-width:thin;background:var(--surface)}
    .bench-projects{display:flex;flex-direction:column;border-right:1px solid var(--line);overflow:auto}
    .bench-projects .heading{margin-bottom:22px}
    .bench-projects h2{font-size:20px;letter-spacing:-.7px;min-width:0}
    .bench-header-actions{display:flex;align-items:center;gap:1px;flex:none}.bench-header-actions .icon{padding:5px;min-width:28px;min-height:34px}
    .bench-mobile-heading{display:flex;align-items:center;justify-content:space-between;width:100%}.bench-mobile-heading h2{font-size:16px}
    .hotel-origin-label{color:var(--muted);font-size:12px;margin-bottom:9px}
    .hotel-switch{display:flex;border:1px solid var(--line);border-radius:7px;background:var(--canvas);padding:2px;flex:none;gap:2px}
    .hotel-switch button{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-height:38px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--muted);font-size:11px;font-weight:600;padding:4px 2px}
    .hotel-switch button:hover{color:var(--text)}
    .hotel-switch button[aria-pressed=true]{background:var(--accent-soft);border-color:var(--accent);color:var(--text)}
    .bench-projects>.control{margin:20px 0 16px}
    #project-list-slot{min-height:80px;flex:1;overflow:auto;scrollbar-width:thin}
    .project-list{display:flex;flex-direction:column;gap:8px}
    .project-entry{position:relative;min-width:0}.project-entry:has(.project-menu-trigger) .project{padding-right:35px}
    .project-entry>.project-menu-trigger{position:absolute;right:3px;top:9px;min-width:28px;min-height:30px;padding:5px;color:var(--muted)}
    .project-entry>.project-menu-trigger[aria-expanded=true]{background:var(--canvas);color:var(--text)}
    .project{display:grid;grid-template-columns:46px minmax(0,1fr);column-gap:13px;row-gap:0;position:relative;width:100%;min-width:0;min-height:84px;padding:12px;border:0;border-radius:7px;background:transparent;color:var(--text);text-align:left}
    .project::before{content:'';grid-row:1/4;width:46px;height:46px;align-self:center;border-radius:6px;border:1px solid var(--line);background:var(--canvas) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 46 46' fill='none'%3E%3Cpath d='m6 23 17-10 17 10-17 10L6 23Z' fill='%23B8CFDF' stroke='%237A98AC'/%3E%3Cpath d='m12 19 17 10m-11-13 17 10m-23 0 17-10m-11 13 17-10' stroke='%237A98AC'/%3E%3Cpath d='M6 23v3l17 10 17-10v-3L23 33 6 23Z' fill='%237A98AC'/%3E%3C/svg%3E") center/40px no-repeat}
    .project:hover{background:var(--canvas)}
    .project.active{background:var(--accent-soft)}
    .project.active::after{content:'';position:absolute;left:0;top:9px;bottom:9px;width:3px;background:var(--accent);border-radius:2px}
    .project.active::before{border-color:var(--accent);background-color:var(--accent-soft)}
    .project-date{grid-column:2;display:block;font-size:10px;color:var(--muted);line-height:1.5;margin-top:2px}
    .project b{display:block;font-weight:750;font-size:14px;overflow-wrap:anywhere;min-width:0;align-self:end}
    .project span{display:block;grid-column:2;align-self:start;font-size:12px;color:var(--muted);margin-top:3px}
    .bench-project-actions{display:flex;flex-direction:column;gap:9px;margin-top:22px;padding-top:4px;flex:none}
    .bench-project-actions .button{min-height:43px;font-size:12px}
    .bench-project-actions .hint:empty{display:none}
    .bench-project-actions .hint{font-size:11px;margin:0}
    .bench-center{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;background:var(--canvas)}
    .bench-preview-head{display:flex;flex-direction:column;gap:9px;padding:28px 30px 0;z-index:1;flex:none}
    .bench-preview-head>strong{font-size:36px;font-weight:800;letter-spacing:-1.3px;line-height:1.12;max-width:100%;overflow-wrap:anywhere}
    .bench-project-meta{font-size:12px;color:var(--muted)}
    .room-preview{flex:1;min-height:200px;position:relative;overflow:hidden;background-color:var(--canvas)}
    .room-preview::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(30deg,transparent 49%,var(--grid) 49.5%,var(--grid) 50.5%,transparent 51%),linear-gradient(150deg,transparent 49%,var(--grid) 49.5%,var(--grid) 50.5%,transparent 51%);background-size:72px 42px}
    .room-preview>div{position:relative}
    .bench-preview-actions{display:flex;justify-content:center;gap:6px;align-items:center;flex:none;padding:6px 16px 0}
    .bench-zoom{display:flex;align-items:center;gap:3px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 3px 10px #20262C09;padding:3px}
    .bench-zoom>span{padding:0 13px;color:var(--muted);font-size:11px;border-left:1px solid var(--line);border-right:1px solid var(--line)}
    .bench-preview-actions .icon{min-height:36px;min-width:36px;border-radius:7px}
    .bench-preview-actions>#preview-fit{min-width:44px;min-height:44px;background:var(--surface);border-color:var(--line);border-radius:10px}
    .bench-empty{position:absolute;inset:115px 0 90px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;text-align:center;pointer-events:none;color:var(--muted);font-size:13px;gap:10px}
    .bench-empty strong{font-size:25px;line-height:1.2;font-weight:750;letter-spacing:-.7px;color:var(--text)}
    .bench-empty span{max-width:350px;line-height:1.7}
    .bench-caption{padding:10px 20px 20px;font-size:10px;color:var(--muted);flex:none;text-align:center}
    .bench-details{min-width:0;min-height:0;overflow:auto;background:var(--surface);border-left:1px solid var(--line);scrollbar-width:thin}
    .bench-details>summary{display:none}
    .bench-inspector{min-height:100%;display:flex;flex-direction:column}
    .bench-inspector>h2{font-size:22px;letter-spacing:-.7px;line-height:1.2}
    .conversion-report{margin-top:18px;padding:11px 12px;border:1px solid var(--line);border-radius:6px;background:var(--canvas);font-size:11px;overflow-wrap:anywhere}
    .conversion-direction{font-weight:750;color:var(--text);margin-bottom:5px}
    .conversion-report summary{cursor:pointer;color:var(--muted);font-size:10px;line-height:1.6}
    .conversion-list{list-style:none;padding:0;margin:8px 0 0;max-height:190px;overflow:auto;scrollbar-width:thin}
    .conversion-list:empty{display:none}.conversion-list li{border-top:1px solid var(--line);padding:7px 0;font-size:10px;color:var(--muted)}
    .inventory-title{margin-top:26px;font-size:14px}
    .bench-summary{display:grid;grid-template-columns:1fr 1.35fr;grid-template-rows:1fr 1fr;column-gap:14px;margin:12px 0 14px;padding:15px 12px;border:1px solid var(--line);border-radius:7px;min-height:83px}
    .bench-stat{font-size:11px;color:var(--muted);white-space:nowrap;align-self:center}
    .bench-stat:first-child{grid-row:1/3;text-align:center;border-right:1px solid var(--line);padding-right:12px}
    .bench-stat:first-child strong{display:block;font-size:28px;line-height:1.1;color:var(--text);font-weight:800;margin-bottom:4px}
    .bench-stat strong{font-variant-numeric:tabular-nums;color:var(--text);font-size:12px;font-weight:650}
    .bench-stat:last-child strong{color:var(--warning)}
    .bench-refresh{width:100%;font-size:11px;min-height:42px}
    .bench-status{font-size:10px;color:var(--muted);line-height:1.6;margin:7px 0 0}
    .bench-missing,.bench-options{border-top:1px solid var(--line);margin-top:20px;padding-top:3px}
    .bench-missing>summary,.bench-options>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;padding:15px 0;font-size:12px;font-weight:650;color:var(--text);list-style:none}
    .bench-missing>summary::-webkit-details-marker,.bench-options>summary::-webkit-details-marker{display:none}
    .bench-missing>summary::after,.bench-options>summary::after{content:'›';color:var(--muted);font-size:22px;font-weight:400;line-height:1;transform:rotate(0deg)}
    .bench-missing[open]>summary::after,.bench-options[open]>summary::after{transform:rotate(90deg)}
    .needs{padding:0;font-size:12px}
    .step-banner{padding:9px 10px;border-radius:5px;background:var(--canvas);color:var(--muted);font-size:10px;line-height:1.6;margin:0 0 7px}
    .need-type{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 5px;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;color:var(--text);font-size:11px}
    .need-type:hover,.need-type[aria-pressed=true]{background:var(--accent-soft)}
    .need-type>span:first-child{min-width:0;overflow-wrap:anywhere;font-weight:650}
    .need-type small{display:block;margin-top:3px;font-size:10px;font-weight:400;color:var(--muted)}
    .need-type .missing{color:var(--green);font-size:10px;flex:none}
    .need-type .missing[data-missing=true]{color:var(--warning)}
    .bench-inspector #buy{margin-top:12px;width:100%;white-space:normal;font-size:11px}
    .selection-card{margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
    .selection-card h3{margin-bottom:8px;font-size:12px}
    .selection-card .hint{font-size:11px}
    .selection-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px;font-size:11px;color:var(--muted)}
    .selection-values span{background:var(--canvas);border-radius:4px;padding:7px;overflow-wrap:anywhere}
    .selection-candidates{display:flex;flex-direction:column;gap:5px;margin-top:10px}
    .selection-candidates button{text-align:left;justify-content:flex-start;white-space:normal}
    .bench-mount{border-top:1px solid var(--line);margin-top:5px;padding-top:22px}
    .bench-mount h3{font-size:14px;margin-bottom:13px}
    .origin{display:grid;grid-template-columns:1fr 1fr;gap:16px;min-width:0}
    .origin .control{width:100%;margin-top:6px}
    .bench-options .button{width:100%;justify-content:flex-start;white-space:normal;text-align:left;font-size:11px}
    .bench-options .content{padding:0 0 10px}
    .bench-mount-action{margin-top:auto;padding-top:28px}
    .bench-mount-action .hint{font-size:10px;margin-bottom:10px}
    #mount-slot,#mount{width:100%}
    #mount{white-space:normal;font-size:12px}
    #mount:disabled{background:var(--line);border-color:var(--line);color:var(--muted);opacity:1}
    .foreign-hotel .bench-grid{grid-template-columns:250px minmax(0,1fr)}
    .bench-mobile-select{display:none}
    .bench-menu{position:fixed;z-index:20;min-width:200px;max-width:calc(100vw - 20px);padding:6px;background:var(--surface);border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 30px #20262C26}
    .bench-menu .button{display:flex;width:100%;justify-content:flex-start;border:0;background:transparent;font-size:12px;margin:0!important}
    .bench-menu .button:hover:not(:disabled){background:var(--canvas)}
    .resize-handle{position:absolute;bottom:0;right:0;width:18px;height:18px;border:0;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 48%,#87949E 49%,#87949E 54%,transparent 55%,transparent 67%,#87949E 68%,#87949E 73%,transparent 74%);opacity:.6;z-index:4}
    .copy-wait{padding:12px;border-left:3px solid var(--accent);border-radius:5px;background:var(--accent-soft);font-size:12px;color:var(--accent-strong)}

    /* Formas e preferências conservam todos os controles e comportamentos. */
    .build-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:28px;align-items:start;max-width:1120px;margin:0 auto}
    .build-layout>.section{margin:0;padding:0;border:0}
    .build-bottom{grid-column:1/-1}
    .inventory-head{font-size:11px;color:var(--muted);margin-top:10px}
    .groups{display:flex;flex-direction:column;gap:12px;margin-top:14px}
    .group{border:1px solid var(--line);border-left:3px solid var(--group-color);background:var(--surface);border-radius:6px;padding:12px}
    .group-top{display:flex;align-items:center;gap:8px}
    .group-top select{flex:1}
    .group-details{display:grid;grid-template-columns:1fr 1.2fr;gap:10px;margin-top:12px}
    .group-details.has-rise .rise-label{grid-column:1/-1}
    .group-details label{font-size:11px}
    .group-details .control{padding:8px}
    .group-number{font-size:11px;color:var(--muted);min-width:12px}
    .shapes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
    .shape{display:flex;align-items:center;gap:8px;min-height:45px;padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--muted);font-size:11px;text-align:left}
    .shape b{font-size:22px;font-weight:400;line-height:1;color:var(--muted)}
    .shape:hover{border-color:var(--accent)}
    .shape.active{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-strong)}
    .shape.active b{color:var(--accent-strong)}
    .preview{margin-top:16px;overflow:hidden;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
    .preview svg{display:block;width:100%;height:144px}
    .preview-caption{display:flex;justify-content:space-between;gap:12px;padding:9px 12px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
    .preview-caption strong{font-weight:650;color:var(--text)}
    .status-note{margin-top:10px;min-height:18px;font-size:12px;color:var(--warning);overflow-wrap:anywhere}
    #build{margin-top:14px}
    .tool-catalog{margin-top:28px}
    .setting{display:flex;align-items:center;justify-content:space-between;gap:22px;padding:20px 0;border-bottom:1px solid var(--line)}
    .setting-text{flex:1;min-width:0}
    .setting-text strong{font-size:13px;font-weight:750}
    .setting-text p{margin-top:4px}
    .setting .control{width:165px;flex:none}
    .setting input[type=range]{accent-color:var(--accent);width:145px}
    .setting .check{font-size:12px;flex:none}
    .log{max-height:190px;overflow:auto;background:var(--canvas);padding:12px;border:1px solid var(--line);border-radius:6px;font:11px/1.6 Consolas,monospace;color:var(--muted);overflow-wrap:anywhere}
    .log div{padding:4px 0;border-bottom:1px solid var(--line)}
    .log .error{color:var(--danger)}
    .log .success{color:var(--green)}
    .log .warning{color:var(--warning)}

    /* Resultado e progresso permanecem visíveis abaixo da área de trabalho. */
    .studio-task-area{display:flex;flex-direction:column;flex:none;min-height:0;max-height:45%;overflow:hidden;scrollbar-width:thin;background:var(--surface)}
    .execution-critical{order:-2;flex:none;padding:8px 20px;background:var(--warning-soft);border-top:1px solid var(--line);font-size:10px;line-height:1.6;color:var(--warning);overflow-wrap:anywhere}
    .execution-critical[data-state=error]{background:var(--danger-soft);color:var(--danger)}
    .execution-panel{min-height:0;flex:0 1 auto;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain;background:var(--surface);border-top:1px solid var(--line)}
    .execution-panel>summary{display:flex;align-items:baseline;gap:8px 16px;padding:10px 20px;cursor:pointer;font-size:11px;list-style:none;position:sticky;top:0;z-index:1;background:var(--surface)}
    .execution-panel>summary::-webkit-details-marker{display:none}.execution-panel>summary>strong{font-weight:750;flex:none}.execution-panel>summary>span{font-size:10px;color:var(--muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .execution-panel>summary::after{content:'⌄';margin-left:auto;color:var(--muted);flex:none}.execution-panel[open]>summary::after{transform:rotate(180deg)}
    .execution-body{display:flex;flex-direction:column}.studio-task-area>.task{order:-1}
    .operations{padding:13px 20px;border-top:1px solid var(--line);background:var(--surface);flex:none}
    .operations-head{display:flex;align-items:center;gap:10px 16px;flex-wrap:wrap}
    .operations h2{font-size:14px;letter-spacing:-.2px;flex:1;min-width:145px}
    .operation-job-picker{display:flex;align-items:center;gap:8px;font-size:10px;min-width:0;max-width:310px;flex:1}
    .operation-job-picker .control{min-height:33px;padding:6px 9px;font-size:11px;margin:0}
    .operations-head .button{font-size:11px;white-space:normal;min-height:33px}
    .operations-summary{font-size:11px;line-height:1.7;margin-top:7px;color:var(--text);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .operations>.hint{font-size:10px;line-height:1.6;margin-top:4px}
    .operations>details{margin-top:8px}
    .operations>details>summary{cursor:pointer;font-size:11px;font-weight:700;color:var(--muted);padding:4px 0}
    .operations[data-state=pending] #operations-title{color:var(--warning)}
    .operations[data-state=done] #operations-title{color:var(--green)}
    .operations-list-head{display:flex;align-items:end;justify-content:space-between;gap:10px 20px;margin-top:7px}
    .operations-list-head>.hint{font-size:10px;flex:1}
    .operations-list-head label{display:flex;align-items:center;gap:8px;flex:none;font-size:10px}
    .operations-list-head .control{font-size:10px;min-height:32px;padding:6px 8px;margin:0;width:auto;max-width:230px}
    .operation-items{list-style:none;padding:0;margin:9px 0 0;max-height:225px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
    .operation-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:start;gap:10px 15px;padding:11px 2px;border-top:1px solid var(--line);font-size:11px}
    .operation-item-content{min-width:0;overflow-wrap:anywhere}
    .operation-item-content>strong{display:block;font-weight:700;color:var(--text)}
    .operation-item-content>span{display:block;font-size:10px;color:var(--muted);line-height:1.6;margin-top:2px}
    .operation-item-content>span:empty{display:none}
    .operation-item-status{font-size:10px;font-weight:650;padding-top:1px;color:var(--muted);white-space:nowrap}
    .operation-item[data-state=done] .operation-item-status{color:var(--green)}
    .operation-item[data-state=pending] .operation-item-status,.operation-item[data-state=running] .operation-item-status{color:var(--warning)}
    .operation-item[data-state=failed] .operation-item-status{color:var(--danger)}
    .operation-item[data-state=ignored] .operation-item-content{opacity:.7}
    .operation-item .operation-ignore{font-size:10px;min-height:30px;padding:5px 9px;margin-top:-4px}
    .operation-item:focus{outline:2px solid var(--accent);outline-offset:-2px}
    .operation-empty{font-size:11px;color:var(--muted);padding:15px 0}
    .operations-pagination{display:flex;justify-content:flex-end;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:6px;font-size:10px;color:var(--muted)}
    .operations-pagination .button{font-size:10px;min-height:30px;padding:5px 8px}
    .configuration{order:1;position:relative;padding:10px 20px;background:var(--warning-soft);border-top:1px solid var(--line);flex:none;max-height:240px;overflow:auto;scrollbar-width:thin;overscroll-behavior:contain}
    .configuration>summary{font-size:11px;padding:3px 0;color:var(--muted)}
    .configuration[open]>.configuration-head{margin-top:9px}
    .configuration-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .configuration h2{font-size:13px;color:var(--warning);letter-spacing:-.15px}
    .configuration .button{border-color:var(--warning);background:var(--warning-soft);color:var(--warning);font-size:11px;white-space:normal;text-align:left;min-height:32px;padding:6px 10px}
    .configuration-summary{margin-top:4px;font-size:11px;color:var(--warning);overflow-wrap:anywhere}
    .configuration .hint{font-size:10px;color:var(--warning);margin-top:4px}
    .configuration details{margin-top:5px}
    .configuration summary{display:list-item;cursor:pointer;font-size:11px;font-weight:750;color:var(--warning);padding:3px 0}
    .configuration-list{list-style:none;padding:0;margin:6px 0;max-height:120px;overflow:auto;scrollbar-width:thin}
    .configuration-list li{padding:7px 0;border-top:1px solid var(--line);font-size:11px;overflow-wrap:anywhere}
    .configuration-list strong,.configuration-list span{display:block}
    .configuration-list span{margin-top:3px;color:var(--warning)}
    .configuration[data-state=ready]{background:var(--green-soft);border-top-color:var(--line)}
    .configuration[data-state=ready] h2,.configuration[data-state=ready] .configuration-summary,.configuration[data-state=ready] .hint,.configuration[data-state=ready] summary{color:var(--green)}
    .task{display:grid;grid-template-columns:minmax(160px,1fr) minmax(100px,2fr) auto;align-items:center;gap:14px 22px;padding:15px 22px;background:var(--surface);border-top:1px solid var(--line);flex:none}
    .task-top{display:flex;flex-direction:column;gap:3px;font-size:12px;min-width:0}
    .task-top strong{font-size:17px;line-height:1.2;font-weight:750;letter-spacing:-.4px;overflow-wrap:anywhere}
    #task-count{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
    .track{height:7px;background:var(--line);border-radius:4px;overflow:hidden;min-width:0}
    .fill{height:100%;width:0;background:var(--accent);transition:width .2s;border-radius:4px}
    .task-sub{display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:0;font-size:10px;color:var(--muted)}
    #task-note{max-width:290px;overflow-wrap:anywhere;text-align:right}
    .task-controls{display:flex;gap:8px}
    .task-controls .button{font-size:12px;min-height:36px;padding:8px 16px}
    #pause{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
    #cancel{border-color:transparent;background:transparent;color:var(--muted)}
    .task.idle .track{display:none}
    .task.idle{grid-template-columns:1fr auto}
    .footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:none;padding:7px 24px;background:var(--surface);border-top:1px solid var(--line);color:var(--muted);font-size:9px;line-height:1.4}
    .launcher{display:none;align-items:center;gap:10px;padding:11px 15px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--text);box-shadow:0 8px 28px #20262C26;font:750 15px 'Constructor Display','Bricolage Grotesque','Segoe UI',sans-serif}
    .launcher{touch-action:none;user-select:none;cursor:grab}
    .launcher:active{cursor:grabbing}
    .launcher svg{width:28px;height:28px;stroke:none}
    .minimized .panel{display:none}
    .minimized .launcher{display:flex}
    .toast{display:none;position:absolute;z-index:5;bottom:34px;right:16px;left:auto;width:min(420px,calc(100% - 32px));padding:12px 35px 12px 15px;border:1px solid var(--green);border-left:3px solid #43846A;border-radius:7px;background:var(--green-soft);color:var(--green);box-shadow:0 6px 24px #20262C1A;font:12px/1.6 'Constructor Manrope','Manrope','Segoe UI',sans-serif;overflow-wrap:anywhere}
    .toast.visible{display:block}
    .toast.error{background:var(--danger-soft);border-color:var(--danger);border-left-color:var(--danger);color:var(--danger)}
    .toast.warning{background:var(--warning-soft);border-color:var(--warning);border-left-color:var(--warning);color:var(--warning)}
    .toast button{position:absolute;right:6px;top:5px;border:0;background:transparent;color:inherit;font-size:20px;padding:0 5px;min-width:25px;min-height:25px}
    .minimized .toast{position:relative;left:auto;right:auto;bottom:auto;max-width:300px;width:100%;margin-top:10px}
    dialog{width:400px;max-width:calc(100vw - 24px);padding:24px;border:1px solid var(--line);border-radius:10px;box-shadow:0 18px 70px #20262C33;background:var(--surface);color:var(--text);font:13px/1.6 'Constructor Manrope','Manrope','Segoe UI',sans-serif}
    dialog::backdrop{background:var(--overlay)}
    dialog h2{font:750 23px/1.2 'Constructor Display','Bricolage Grotesque','Segoe UI',sans-serif;margin-bottom:14px}
    dialog p{white-space:pre-line;overflow-wrap:anywhere;color:var(--muted)}

    .project-link-dialog{width:430px;max-height:calc(100dvh - 24px);overflow:auto}
    .project-link-heading{display:flex;align-items:start;justify-content:space-between;gap:12px}.project-link-heading h2{margin-bottom:12px}.project-link-heading .icon{font-size:23px;margin:-8px -8px 0 0}
    #project-link-state{font-weight:700;color:var(--text);font-size:13px;line-height:1.5}
    #project-link-help{margin-top:7px;font-size:11px}
    #project-link-start,#project-link-invite{margin-top:22px}
    .project-link-join{margin-top:20px;padding-top:18px;border-top:1px solid var(--line)}.project-link-join .control{margin:6px 0 10px}
    #project-link-code{display:block;user-select:all;text-align:center;font-size:25px;font-weight:750;letter-spacing:2px;padding:15px 10px;margin-top:7px;border:1px solid var(--line);border-radius:6px;background:var(--canvas);overflow-wrap:anywhere}
    #project-link-candidate:empty,#project-link-feedback:empty{display:none}#project-link-candidate{margin-top:17px;padding:10px 12px;background:var(--accent-soft);border-radius:5px;color:var(--accent-strong)}
    .project-link-actions{margin-top:20px}.project-link-actions .button{font-size:11px;white-space:normal}.project-link-actions:has(>button:not([hidden])){display:flex}.project-link-actions:not(:has(>button:not([hidden]))){display:none}
    .toast .toast-action{position:static;display:block;padding:6px 0 0;border:0;min-height:30px;font:inherit;font-weight:750;text-decoration:underline;text-underline-offset:3px;background:transparent;color:inherit}

    @container(max-width:1150px){
      .header{grid-template-columns:minmax(175px,1fr) auto minmax(175px,1fr);gap:14px;padding:0 18px}
      .brand h1{font-size:24px}.brand p{display:none}.tabs{gap:14px}.header-end{gap:10px}
      #connection-text{max-width:125px}.bench-grid{grid-template-columns:218px minmax(0,1fr) 268px}.foreign-hotel .bench-grid{grid-template-columns:218px minmax(0,1fr)}
      .bench-projects,.bench-inspector{padding:22px 17px}.bench-projects h2,.bench-inspector>h2{font-size:19px}.bench-projects .heading{gap:4px}.bench-projects h2{font-size:18px}.bench-preview-head{padding:25px 24px 0}.bench-preview-head>strong{font-size:32px}
      .task{grid-template-columns:minmax(140px,1fr) minmax(80px,1fr) auto;gap:14px}
    }
    @container(max-width:900px){
      .header{grid-template-columns:1fr auto;gap:0 14px;padding:12px 16px 0;min-height:96px}
      .tabs{grid-column:1/-1;grid-row:2;justify-content:center;gap:28px;margin-top:4px}.tab{min-height:42px}
      .header-end{grid-column:2;grid-row:1}.brand-lockup{grid-column:1;grid-row:1}.mark{width:31px;height:31px}.brand h1{font-size:24px}#connection-text{max-width:155px}
      .bench-grid{grid-template-columns:190px minmax(0,1fr) 236px}.foreign-hotel .bench-grid{grid-template-columns:190px minmax(0,1fr)}
      .bench-projects,.bench-inspector{padding:18px 13px}.bench-projects h2,.bench-inspector>h2{font-size:18px}.bench-projects .heading{gap:3px}.bench-projects h2{font-size:16px}.bench-header-actions .icon{min-width:25px;padding:3px}.hotel-switch button{font-size:10px}
      .project{min-height:74px;padding:10px 8px;grid-template-columns:35px minmax(0,1fr);column-gap:9px}.project::before{width:35px;height:35px;background-size:32px}.project b{font-size:12px}.project span{font-size:10px}
      .bench-preview-head{padding:22px 18px 0}.bench-preview-head>strong{font-size:28px}.bench-project-meta{font-size:11px}
      .bench-summary{column-gap:9px;padding:13px 8px}.bench-stat{font-size:10px}.bench-stat:first-child{padding-right:8px}.bench-stat:first-child strong{font-size:26px}
      .task-top strong{font-size:15px}.task-controls .button{padding:8px 11px}.task{padding:12px 16px;gap:12px}#task-note{font-size:9px;max-width:210px}.body{padding:20px}
    }
    @container(max-width:740px){
      .execution-panel>summary{padding:10px 16px}.execution-critical{padding:8px 16px}.capture-form-slot{padding:12px 16px;max-height:250px}
      .operations{padding:11px 16px}.operations-head{gap:8px 12px}.operations h2{font-size:13px}.operation-job-picker{max-width:none;flex:1 1 190px}
      .operations-list-head{flex-direction:column;align-items:stretch;gap:7px}.operations-list-head label{justify-content:space-between}.operations-list-head .control{max-width:100%}
      .operation-item{gap:8px 11px}.operations-summary{font-size:10px}
      .bench-grid,.foreign-hotel .bench-grid{display:flex;flex-direction:column;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
      .bench-projects{display:none}
      .bench-mobile-select{display:flex;flex-wrap:wrap;align-items:end;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface);flex:none}
      .bench-mobile-select .hotel-switch{width:100%}.bench-mobile-select .hotel-switch button{min-height:33px}
      .bench-mobile-select label{flex:1;min-width:110px;font-size:10px}.bench-mobile-select select{padding:7px 9px;margin-top:3px;min-height:35px}
      .bench-mobile-select .button{padding:8px;font-size:11px;white-space:normal;max-width:110px;min-height:35px}
      .bench-center{flex:1 0 355px;min-height:355px}.room-preview{min-height:180px}
      .bench-preview-head{padding:18px 20px 0}.bench-preview-head>strong{font-size:27px}.bench-caption{padding:8px 16px 13px}.bench-preview-actions{padding-top:0}
      .bench-empty{inset:100px 0 85px;padding:22px}.bench-empty strong{font-size:23px}
      .bench-details{flex:none;border-left:0;border-top:1px solid var(--line);overflow:visible;max-height:none}
      .bench-details>summary{display:list-item;padding:14px 20px;font-weight:750;font-size:13px;color:var(--text);cursor:pointer;background:var(--surface)}
      .bench-details:not([open]) .bench-inspector{display:none}.bench-inspector{padding:18px 20px;min-height:0}
      .bench-inspector>h2{display:none}.inventory-title{margin-top:0}.bench-summary{grid-template-columns:1fr 2fr}.bench-stat{font-size:12px}
      .bench-mount-action{padding-top:20px}.origin{gap:15px}.bench-options{margin-top:20px}
      .build-layout{display:block}.build-layout>.section+section{margin-top:24px;padding-top:24px;border-top:1px solid var(--line)}
      .shapes{grid-template-columns:repeat(3,minmax(0,1fr))}.body{padding:18px}
      .task{grid-template-columns:minmax(0,1fr) auto;gap:9px 14px;padding:12px 16px}.task-top{grid-column:1;grid-row:1}.track{grid-column:1;grid-row:2}.task-sub{grid-column:2;grid-row:1/3;max-width:210px}
      #task-note{display:none}.task-controls .button{font-size:11px;padding:8px 12px}.configuration{padding:9px 16px;max-height:180px}
    }
    @container(max-width:460px){
      .execution-panel>summary{padding:9px 12px;flex-wrap:wrap;gap:3px 9px}.execution-panel>summary>span{flex-basis:100%;order:2}.execution-panel>summary::after{position:absolute;right:12px;top:9px}.execution-critical{padding:7px 12px;font-size:10px}
      .capture-form-slot{padding:11px 12px;max-height:280px}.capture-form-slot .row{flex-wrap:wrap}.capture-form-slot .row>.auto{width:100%}
      .operations{padding:10px 12px}.operations-head .operation-job-picker{order:2;flex:1 0 100%}.operations-head>.button{font-size:10px;max-width:145px}.operations h2{min-width:115px;font-size:12px}
      .operation-item{grid-template-columns:minmax(0,1fr) auto;gap:6px 9px}.operation-item-content{grid-column:1;grid-row:1/3}.operation-item-status{grid-column:2;grid-row:1}.operation-item .operation-ignore{grid-column:2;grid-row:2;margin:0;justify-self:end}
      .operations-pagination{justify-content:space-between;gap:6px}
      .header{padding:10px 12px 0;min-height:126px}.brand-lockup{gap:7px}.brand h1{font-size:23px}.mark{width:29px;height:29px}
      .header-end{display:contents}.connection{grid-column:1;grid-row:2;font-size:10px;padding:7px 0;gap:6px}.connection #connection-text{max-width:none}.connection .demo{display:none}
      .window-actions{grid-column:2;grid-row:1;padding-left:7px;gap:0}.window-actions .icon{padding:6px;min-width:29px;min-height:32px}
      .tabs{grid-row:3;gap:23px;margin-top:0}.tab{font-size:12px;min-height:38px}.body{padding:14px}
      .bench-mobile-select{gap:6px;padding:8px 12px}.bench-inspector{padding:17px}.bench-preview-head>strong{font-size:25px}
      .shapes{grid-template-columns:repeat(2,minmax(0,1fr))}.setting{gap:12px;padding:16px 0}.setting .control{width:120px}.setting input[type=range]{width:100px}
      .setting-text .hint{font-size:11px}.actions{gap:7px}.actions .button{font-size:11px;padding:9px}.row{flex-wrap:wrap}.row>.auto{flex:1 0 100%}
      .task{gap:8px 10px;padding:12px}.task-top strong{font-size:14px}.task-controls{gap:3px}.task-controls .button{padding:7px 9px;min-height:34px}
      .configuration-head{gap:6px}.configuration h2{font-size:12px}.configuration .button{padding:6px 8px;font-size:10px}.configuration-summary{font-size:10px}.configuration{padding:8px 12px}
      .footer{padding:6px 18px 7px 12px;font-size:8px}.footer span:first-child{max-width:190px}.toast{right:10px;bottom:28px;width:calc(100% - 20px)}
    }
    @container(max-width:360px){.header{padding:10px 10px 0;gap:0 8px}.brand h1{font-size:21px}.brand-lockup{gap:5px}.window-actions{padding-left:0;border:0}.tabs{gap:18px}.task-controls .button{padding:7px}.configuration-head .button{width:100%;justify-content:center}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  `;
  ctx.parts.add('styles.js');
})();
