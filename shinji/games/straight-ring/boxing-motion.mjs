// Animation follows the actual engine contact time, not a free-running sprite loop.
export const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
const ease=t=>t*t*(3-2*t);
const mix=(a,b,t)=>a+(b-a)*t;
// [torso drive, lead reach, lead lift, knee dip, shoulder turn, rear reach, rear lift]
const zero=[0,0,0,0,0,0,0];
const move={
  jab:{load:[-8,-12,-1,2,-.055,-5,3],hit:[19,41,9,0,.078,-12,12],through:[15,35,8,1,.065,-10,10],wind:.30,snap:.085,end:.20},
  straight:{load:[-19,-22,-6,7,-.18,-9,7],hit:[37,65,5,-2,.20,-9,16],through:[33,57,1,0,.23,-8,10],wind:.49,snap:.095,end:.25},
  hook:{load:[-16,-28,10,10,-.26,-14,10],hit:[25,38,33,1,.29,-16,18],through:[34,25,18,2,.32,-11,14],wind:.48,snap:.082,end:.29},
  upper:{load:[-15,-20,-31,28,-.18,-6,16],hit:[21,26,66,-6,.10,-14,14],through:[24,17,56,-10,.14,-13,11],wind:.53,snap:.080,end:.24},
  card:{load:[-24,-27,-8,14,-.24,-13,9],hit:[44,74,12,-4,.23,-17,20],through:[39,63,8,0,.29,-11,15],wind:.49,snap:.105,end:.25},
};
const lerpPose=(a,b,t)=>a.map((v,i)=>mix(v,b[i],t));

export function motionPose(actor,now){
  const a=actor.attack,cfg=move[a?.kind];
  if(!cfg){
    const hurt=Number.isFinite(actor.stun)?clamp((actor.stun-now)/135):0;
    return {drive:-19*hurt,reach:-3*hurt,lift:0,knee:4*hurt,lean:-.15*hurt,rearReach:0,rearLift:0,trail:0,charge:0};
  }
  const before=Math.max(1,a.hit-a.start),after=Math.max(1,(actor.until??a.hit+150)-a.hit);
  const first=clamp((now-a.start)/before),later=clamp((now-a.hit)/after);
  const rise=clamp((first-cfg.wind)/(1-cfg.wind)),snap=clamp(cfg.snap*1000/after,0,.32);
  const follow=Math.max(snap+.06,cfg.end+.12);
  let v,trail=0,charge=0;
  if(now<a.hit){
    if(first<cfg.wind){
      v=lerpPose(zero,cfg.load,ease(first/cfg.wind));
      if(a.kind==='card')charge=ease(first/cfg.wind);
    }else{
      const shoot=ease(rise);
      v=lerpPose(cfg.load,cfg.hit,shoot);
      trail=ease(clamp((rise-.35)/.65));
      if(a.kind==='card')charge=1-shoot;
    }
  }else if(later<snap){
    // Briefly present the contact silhouette, even if a mobile frame arrives
    // after engine hit resolution, without changing input or hit timing.
    v=cfg.hit;trail=mix(1,.80,ease(later/snap));
  }else if(later<follow){
    const impact=ease((later-snap)/(follow-snap));
    v=lerpPose(cfg.hit,cfg.through,impact);trail=mix(.80,.48,impact);
  }else{
    const rec=ease((later-follow)/(1-follow));
    v=lerpPose(cfg.through,zero,rec);trail=.48*Math.pow(1-rec,3);
  }
  return {drive:v[0],reach:v[1],lift:v[2],knee:v[3],lean:v[4],rearReach:v[5],rearLift:v[6],trail,charge};
}

// Per-fighter interpolation is keyed by the engine's actor objects; this keeps
// left/right fighter animation and footsteps isolated across bouts.
const actors=new WeakMap();
export function footwork(actor,now){
  let ref=actors.get(actor);
  if(!ref||now<ref.now||now-ref.now>200){
    ref={now,x:actor.x,y:actor.y,vx:0,vy:0,cycle:0,brace:actor.guard?1:0};
    actors.set(actor,ref);
  }
  const dt=now-ref.now;
  if(dt>0){
    const w=1-Math.pow(.78,dt/16.7),brace=1-Math.exp(-dt/(actor.guard?28:44));
    ref.vx=mix(ref.vx,clamp((actor.x-ref.x)/dt,-.34,.34),w);
    ref.vy=mix(ref.vy,clamp((actor.y-ref.y)/dt,-.16,.16),w);
    ref.brace=mix(ref.brace,actor.guard?1:0,brace);
    ref.cycle+=dt*(.006+Math.hypot(ref.vx,ref.vy)*.038);
    ref.now=now;ref.x=actor.x;ref.y=actor.y;
  }
  return ref;
}
