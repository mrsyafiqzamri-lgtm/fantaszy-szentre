(() => {
  'use strict';

  const n=v=>Number(v||0);
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,n(v)));
  const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const xp=p=>n(p?.xp?.[0]);
  const pos=p=>Number(p?.element_type||0);
  const isAttack=p=>pos(p)===3||pos(p)===4;
  const isDefence=p=>pos(p)===1||pos(p)===2;

  function ready(){
    return Boolean(window.FS30?.ensure?.()&&state?.nextEvents?.length);
  }

  function mean(arr){
    return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;
  }

  function meanTop(arr,k){
    return mean([...arr].sort((a,b)=>b-a).slice(0,k));
  }

  function teamMetric(teamId){
    const players=FS30.strictPlayers().filter(p=>Number(p.team)===Number(teamId));
    const attack=meanTop(players.filter(isAttack).map(p=>{
      const mins=clamp(n(p.xmins)/90,.25,1);
      return (xp(p)+.20*Math.max(0,n(p.ceiling)-xp(p))+.004*n(p.fixtureQualityScore))*mins;
    }),4);
    const defence=meanTop(players.filter(isDefence).map(p=>{
      const mins=clamp(n(p.xmins)/90,.25,1);
      return (xp(p)+.009*n(p.lineupScore)+.003*n(p.fixtureQualityScore))*mins;
    }),4);
    const availability=meanTop(players.map(p=>clamp(n(p.xmins)/90,0,1)),11);
    return {attack,defence,availability};
  }

  function allMetrics(){
    const map=new Map();
    for(const t of state.teams)map.set(Number(t.id),teamMetric(t.id));
    return map;
  }

  function meanField(field,metrics){
    return mean([...metrics.values()].map(x=>n(x[field])).filter(x=>x>0))||1;
  }

  function strengthMean(field){
    const values=state.teams.map(t=>n(t[field])).filter(v=>v>0);
    return mean(values)||1;
  }

  function poisson(k,lambda){
    let fact=1;
    for(let i=2;i<=k;i++)fact*=i;
    return Math.exp(-lambda)*Math.pow(lambda,k)/fact;
  }

  function outcomeProb(lambdaH,lambdaA){
    let home=0,draw=0,away=0,maxJoint=0;
    const cells=[];
    for(let h=0;h<=6;h++){
      for(let a=0;a<=6;a++){
        const p=poisson(h,lambdaH)*poisson(a,lambdaA);
        maxJoint=Math.max(maxJoint,p);
        if(h>a)home+=p;else if(a>h)away+=p;else draw+=p;
        cells.push({h,a,p});
      }
    }
    const mass=home+draw+away||1;
    return {home:home/mass,draw:draw/mass,away:away/mass,maxJoint,cells};
  }

  function representativeScore(lambdaH,lambdaA){
    const dist=outcomeProb(lambdaH,lambdaA);
    let outcome='draw';
    if(dist.home>dist.away+.08)outcome='home';
    else if(dist.away>dist.home+.08)outcome='away';
    else if(dist.draw>=Math.max(dist.home,dist.away)-.03)outcome='draw';
    else outcome=dist.home>=dist.away?'home':'away';

    const totalTarget=clamp(Math.round(lambdaH+lambdaA),1,6);
    const marginTarget=clamp(Math.round(lambdaH-lambdaA),-3,3);
    let best=null;

    for(const c of dist.cells){
      if(outcome==='home'&&c.h<=c.a)continue;
      if(outcome==='away'&&c.a<=c.h)continue;
      if(outcome==='draw'&&c.h!==c.a)continue;

      const total=c.h+c.a;
      const targetDist=Math.abs(total-totalTarget);
      const individualDist=Math.abs(c.h-lambdaH)+Math.abs(c.a-lambdaA);
      const marginDist=Math.abs((c.h-c.a)-marginTarget);
      const probScore=dist.maxJoint?c.p/dist.maxJoint:0;

      let score=
        1.35*probScore
        -1.00*targetDist
        -.42*individualDist
        -.24*marginDist;

      // Strong one-sided 3.0 profiles should be allowed to express a clean sheet
      // instead of being dragged toward 2-1/1-1 by the modal Poisson cell.
      if(outcome==='home'&&lambdaA<.85&&c.a===0)score+=.40;
      if(outcome==='away'&&lambdaH<.85&&c.h===0)score+=.40;

      if(!best||score>best.score)best={...c,score};
    }

    if(!best){
      return {home:Math.max(0,Math.round(lambdaH)),away:Math.max(0,Math.round(lambdaA))};
    }
    return {home:best.h,away:best.a};
  }

  function prediction(f,metrics){
    const homeTeam=state.teams.find(t=>Number(t.id)===Number(f.team_h));
    const awayTeam=state.teams.find(t=>Number(t.id)===Number(f.team_a));
    const h=metrics.get(Number(f.team_h))||{attack:1,defence:1,availability:1};
    const a=metrics.get(Number(f.team_a))||{attack:1,defence:1,availability:1};

    const meanAttack=meanField('attack',metrics);
    const meanDef=meanField('defence',metrics);

    const hAttack3=h.attack/meanAttack;
    const aAttack3=a.attack/meanAttack;
    const hWeakDef=meanDef/Math.max(.25,h.defence);
    const aWeakDef=meanDef/Math.max(.25,a.defence);

    const ahMean=strengthMean('strength_attack_home');
    const aaMean=strengthMean('strength_attack_away');
    const dhMean=strengthMean('strength_defence_home');
    const daMean=strengthMean('strength_defence_away');

    const hAttackPrior=n(homeTeam?.strength_attack_home)>0?n(homeTeam.strength_attack_home)/ahMean:1;
    const aAttackPrior=n(awayTeam?.strength_attack_away)>0?n(awayTeam.strength_attack_away)/aaMean:1;
    const aDefWeakPrior=n(awayTeam?.strength_defence_away)>0?daMean/n(awayTeam.strength_defence_away):1;
    const hDefWeakPrior=n(homeTeam?.strength_defence_home)>0?dhMean/n(homeTeam.strength_defence_home):1;

    const hAttack=.76*hAttack3+.24*hAttackPrior;
    const aAttack=.76*aAttack3+.24*aAttackPrior;
    const aWeak=.78*aWeakDef+.22*aDefWeakPrior;
    const hWeak=.78*hWeakDef+.22*hDefWeakPrior;

    const hAvail=.92+.08*clamp(h.availability,0,1);
    const aAvail=.92+.08*clamp(a.availability,0,1);

    const lambdaH=clamp(1.46*hAttack*(.82+.18*aWeak)*hAvail, .30, 3.70);
    const lambdaA=clamp(1.23*aAttack*(.82+.18*hWeak)*aAvail, .25, 3.35);
    const score=representativeScore(lambdaH,lambdaA);

    return {
      home:homeTeam?.short_name||String(f.team_h),
      away:awayTeam?.short_name||String(f.team_a),
      homeGoals:score.home,
      awayGoals:score.away,
      // Kept internal for system reasoning/audit; UI only renders the score.
      _engine:{lambdaH,lambdaA,model:'SZxP 3.0 Match Representative Score'}
    };
  }

  function predictions(){
    if(!ready())return [];
    const gw=Number(state.nextEvents?.[0]?.id||0);
    const metrics=allMetrics();
    return (state.fixtures||[])
      .filter(f=>Number(f.event)===gw)
      .sort((a,b)=>n(a.kickoff_time?Date.parse(a.kickoff_time):0)-n(b.kickoff_time?Date.parse(b.kickoff_time):0))
      .map(f=>prediction(f,metrics));
  }

  function markup(){
    if(!ready())return '<div class="fs30-empty">Waiting for verified 3.0 production data.</div>';
    const rows=predictions();
    return `<div class="fs30-match-list">
      ${rows.map(r=>`<div class="fs30-match-row"><b>${esc(r.home)} ${r.homeGoals}–${r.awayGoals} ${esc(r.away)}</b></div>`).join('')||'<div class="fs30-empty">No fixtures found.</div>'}
    </div>`;
  }

  function inject(){
    const more=document.getElementById('more');
    if(!more)return false;
    const cards=[...more.querySelectorAll('.fs-more .fs-card')];
    const target=cards.find(card=>/Match Szentre|Match Predictions/i.test(card.querySelector('h2')?.textContent||''));
    if(!target)return false;
    if(target.dataset.match30Stamp===String(state?.meta?.updated_at_utc||''))return true;
    target.dataset.match30Stamp=String(state?.meta?.updated_at_utc||'');
    target.classList.add('fs30-match-card');
    target.innerHTML=`<h2>Match Predictions</h2>${markup()}`;
    return true;
  }

  let attempts=0;
  const timer=setInterval(()=>{
    attempts++;
    inject();
    if(attempts>60)clearInterval(timer);
  },500);

  document.getElementById('refreshBtn')?.addEventListener('click',()=>setTimeout(inject,1600));
  window.FSMatch30={version:'20260909-match30-1',predictions,markup,inject};
})();