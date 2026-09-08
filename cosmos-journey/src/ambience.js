// Artistic sound design for each scientific epoch: no melody, chords or beat grid.
export const AMBIENCE_PROFILES = [
  { zh: '量子涨落 · 细碎脉冲', en: 'Quantum fluctuations · granular pulses' },
  { zh: '空间暴胀 · 扩张气流', en: 'Inflation · expanding rush' },
  { zh: '粒子海 · 密集碰撞', en: 'Particle sea · dense collisions' },
  { zh: '核子形成 · 成组聚合', en: 'Nucleons · clustered impacts' },
  { zh: '原初核合成 · 聚变脉冲', en: 'Nucleosynthesis · fusion bursts' },
  { zh: '原子形成 · 雾散清透', en: 'Neutral atoms · clearing haze' },
  { zh: '微波背景 · 细密余波', en: 'Microwave background · fine static' },
  { zh: '黑暗时代 · 低沉远响', en: 'Dark ages · distant low rumble' },
  { zh: '恒星点亮 · 点燃与迸发', en: 'First stars · ignition flares' },
  { zh: '星系成网 · 旋转声场', en: 'Cosmic web · orbiting currents' },
  { zh: '持续膨胀 · 辽阔回响', en: 'Expansion · diffuse echoes' }
];
export const AMBIENCE_DURATION = 26;

function field(epoch, duration, rate, transition = false) {
  let randomState = 7459 + epoch * 193;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
  let low = 0, lowRight = 0, deep = 0, deepRight = 0;
  let lastEvent = -.2, nextEvent = .08, impact = 90;
  const intervals = [.19, 4.8, .055, 1.7, 2.5, 3.5, .8, 7, 3.8, 5.5, 6.4];
  const count = Math.ceil(duration * rate), left = new Float32Array(count), right = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const t = i / rate, progress = t / duration;
    const white = random() * 2 - 1, other = random() * 2 - 1;
    if (t >= nextEvent) {
      lastEvent = t; impact = 85 + random() * 520;
      nextEvent = t + intervals[epoch] * (.5 + random());
    }
    const age = t - lastEvent;
    const bodyFilter = epoch === 1 ? .008 + progress * .13 : [.06,.06,.23,.035,.025,.03,.28,.002,.07,.018,.009][epoch];
    low += bodyFilter * (white - low); lowRight += bodyFilter * (other - lowRight);
    deep += .0015 * (white - deep); deepRight += .0015 * (other - deepRight);
    const pop = Math.min(1, age / .004) * Math.exp(-age / [ .023,.7,.01,.055,.28,.3,.09,.5,.6,.8,.9 ][epoch]);
    const flutter = .55 + .45 * Math.sin(t * (epoch === 0 ? 31.7 : 8.13) + 2.4 * Math.sin(t * 1.23));
    let baseL = 0, baseR = 0, event = 0;
    switch (epoch) {
      case 0:
        baseL = .047 * (white - low) * flutter + deep * .7;
        baseR = .047 * (other - lowRight) * (1.1 - flutter * .6) + deepRight * .7;
        event = pop * .18 * Math.sin(2 * Math.PI * impact * age);
        break;
      case 1: {
        const pressure = .10 + .42 * progress;
        baseL = low * pressure + deep * 1.3; baseR = lowRight * pressure + deepRight * 1.3;
        event = Math.sin(2 * Math.PI * (43 * t + 28 * t * t / duration)) * .034 * Math.sin(Math.PI * progress);
        break;
      }
      case 2:
        baseL = (white - low) * .10 + low * .16; baseR = (other - lowRight) * .10 + lowRight * .16;
        event = pop * .19 * white;
        break;
      case 3: {
        const cluster = [0,.073,.161].reduce((value, delay) => value + (age > delay ? Math.exp(-(age-delay)*43) * Math.sin((age-delay)*impact*8) : 0), 0);
        baseL = low * .16 + deep * .6; baseR = lowRight * .16 + deepRight * .6;
        event = cluster * .14;
        break;
      }
      case 4:
        baseL = low * .25 + deep * 1.1; baseR = lowRight * .25 + deepRight * 1.1;
        event = pop * (.17 * Math.sin(2*Math.PI*(95*age-22*age*age)) + .13*white);
        break;
      case 5: {
        const clearing = 1 - progress * .82;
        baseL = (low * .33 + white * .025) * clearing;
        baseR = (lowRight * .33 + other * .025) * clearing;
        event = pop * .025 * white * clearing;
        break;
      }
      case 6:
        baseL = (white-low)*.085*(.8+.2*Math.sin(t*1.7));
        baseR = (other-lowRight)*.085*(.8+.2*Math.cos(t*1.1));
        break;
      case 7:
        baseL = deep*.8 + low*.05; baseR = deepRight*.8 + lowRight*.05;
        event = pop*.028*Math.sin(age*2*Math.PI*48);
        break;
      case 8:
        baseL = low*.16 + deep*.6; baseR = lowRight*.16 + deepRight*.6;
        event = pop*(white*.22 + Math.sin(2*Math.PI*(impact*age+210*age*age))*.075);
        break;
      case 9: {
        const drift = .55 + .45*Math.sin(t*.56 + Math.sin(t*.12));
        baseL = low*(.24+.26*drift) + deep*.7;
        baseR = lowRight*(.50-.26*drift) + deepRight*.7;
        event = pop*.048*(white+Math.sin(t*2*Math.PI*67));
        break;
      }
      case 10: {
        const swell = .6 + .4*Math.sin(t*.31)**2;
        baseL = (low*.4 + deep*.7 + white*.01)*swell;
        baseR = (lowRight*.4 + deepRight*.7 + other*.01)*(.85+.15*Math.cos(t*.24));
        break;
      }
    }
    const pan = Math.sin(t*.7+epoch)*.45;
    const edge = transition ? Math.min(1,t/.035)*Math.exp(-t*2.7)*Math.min(1,(duration-t)/.08) : Math.min(1,t/.07,(duration-t)/.10);
    const boost = transition ? 2.2 : 1;
    left[i] = Math.tanh((baseL+event*(.8+pan))*boost) * edge;
    right[i] = Math.tanh((baseR+event*(.8-pan))*boost) * edge;
  }
  return [left,right];
}

export function createAmbienceBuffer(context, epoch = 9) {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch >= AMBIENCE_PROFILES.length) throw new RangeError('Unknown cosmic epoch');
  const rate=22050, channels=field(epoch,AMBIENCE_DURATION,rate);
  const buffer=context.createBuffer(2,channels[0].length,rate);
  channels.forEach((data,index)=>buffer.getChannelData(index).set(data));
  return buffer;
}
export function createEffectBuffer(context, epoch) {
  const rate=22050, channels=field(epoch,1.45,rate,true);
  const buffer=context.createBuffer(2,channels[0].length,rate);
  channels.forEach((data,index)=>buffer.getChannelData(index).set(data));
  return buffer;
}
