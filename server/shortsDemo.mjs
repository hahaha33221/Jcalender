/* 숏폼 예시 채우기 — POST /api/shorts/demo
   처음 쓰는 사람이 바로 "⑤ 영상 만들기"를 눌러 볼 수 있게 한 벌을 채운다 (다시 누르면 같은 예시를 새로 고침, 다른 자료는 그대로)
   ① 예시 게시판 글(고른 글) → ② 스크립트 후보 2개(하나 고름) → ③ 예시 배경 3장(그라데이션, ffmpeg 로 만듦) · 배경음악 1곡(잔잔한 화음)
   → ④ 제작 준비(배경 3 + 음악, 검색어 · 분위기). AI · 음성 비용은 들지 않음 (영상 만들기를 누를 때만 음성 비용) */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { ROOT, hasFfmpeg, assetFile, probe } from './shortsAssets.mjs';

const LINK = 'https://example.com/jcalender-shorts-demo';
const BODY = `[예시 글 · 실제 게시판 글이 아닙니다]
오늘 회의 시간에 있었던 일이에요. 팀장님이 갑자기 "다음 주부터 모두 아침 7시까지 출근합시다"라고 하셨어요.
회의실이 순식간에 조용해졌는데, 입사 3개월 차 막내가 손을 들고 "그럼 퇴근은 4시에 해도 되나요?"라고 물었어요.
다들 숨죽이고 있었는데 팀장님이 한참 생각하더니 "좋네, 한 달만 시범으로 해 보자"라고 하셨어요.
그렇게 한 달 동안 7시 출근 4시 퇴근을 해 봤는데, 오히려 오전에 집중이 잘 돼서 일이 더 빨리 끝났어요.
지금은 팀원 절반이 이 시간표를 계속 쓰고 있습니다. 여러분 회사라면 찬성인가요?`;
const SCRIPTS = [
  { title: '팀장님의 7시 출근 선언, 막내의 한마디로 반전',
    script: '여러분, 회의 시간에 팀장님이 갑자기 이렇게 말했다면 어떻게 하시겠어요? 다음 주부터 모두 아침 일곱 시까지 출근하라고요. 회의실이 순식간에 조용해졌습니다. 그런데 입사 석 달 차 막내가 손을 번쩍 들더니, 그럼 퇴근은 오후 네 시에 해도 되냐고 물었어요. 다들 숨을 죽였죠. 팀장님은 한참을 생각하더니, 좋은 생각이라며 한 달만 시범으로 해 보자고 했습니다. 그렇게 한 달 동안 일곱 시 출근, 네 시 퇴근을 해 봤는데요. 오전에 집중이 잘 돼서 일이 오히려 더 빨리 끝났다고 합니다. 여러분 회사라면 이 제도, 찬성인가요 반대인가요?',
    hashtags: '직장인 회사썰 팀장님 출퇴근 쇼츠', chosen: true },
  { title: '7시 출근하자는 팀장님, 막내가 던진 질문',
    script: '아침 일곱 시 출근, 여러분은 가능하세요? 어느 회사 회의 시간, 팀장님이 다음 주부터 일곱 시 출근을 선언했습니다. 모두가 굳어 있을 때 막내가 물었죠. 그럼 네 시에 퇴근해도 되나요? 놀랍게도 팀장님은 한 달 시범 운영을 허락했고, 결과는 대성공이었습니다. 지금은 팀원 절반이 이 시간표로 일한다고 하네요. 여러분이라면 일곱 시 출근, 해 보실 건가요?',
    hashtags: '직장인 회사생활 유연근무', chosen: false },
];
const BGS = [                                                    // 그라데이션 색 (위 → 아래)
  { name: '예시 배경 1 · 새벽 하늘', top: [24, 40, 82], bottom: [236, 142, 98], tags: '예시 새벽 출근' },
  { name: '예시 배경 2 · 사무실 블루', top: [18, 52, 86], bottom: [72, 160, 190], tags: '예시 사무실 회의' },
  { name: '예시 배경 3 · 노을 퇴근', top: [66, 34, 92], bottom: [250, 186, 92], tags: '예시 퇴근 노을' },
];

function ff(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', ...args]);
    let err = ''; p.stderr.on('data', c => { err = (err + c).slice(-500); });
    const t = setTimeout(() => p.kill('SIGKILL'), 120000);
    p.on('close', code => { clearTimeout(t); if (code === 0) resolve(); else reject(new Error(`예시 소재를 만들지 못했습니다 (ffmpeg: ${err.trim().split('\n').pop()})`)); });
    p.on('error', e => { clearTimeout(t); reject(e); });
  });
}
const mix = (a, b, k) => `${a}+(${b - a})*${k}`;
/** 세로 그라데이션 + 은은한 빛 번짐 (1080×1920 jpg) */
const gradient = (g, file) => {
  const k = `(Y/H)`, glow = `40*exp(-((X-W*0.7)*(X-W*0.7)+(Y-H*0.3)*(Y-H*0.3))/(2*260*260))`;
  return ff(['-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=1', '-frames:v', '1', '-vf',
    `format=rgb24,geq=r='clip(${mix(g.top[0], g.bottom[0], k)}+${glow},0,255)':g='clip(${mix(g.top[1], g.bottom[1], k)}+${glow},0,255)':b='clip(${mix(g.top[2], g.bottom[2], k)}+${glow},0,255)'`,
    '-q:v', '3', file]);
};
/** 잔잔한 배경음악 40초: 화음 4개를 10초씩 (C · Am · F · G), 부드럽게 커졌다 작아짐 */
const music = file => {
  const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
  const f = i => `if(lt(mod(t,40),10),${chords[0][i]},if(lt(mod(t,40),20),${chords[1][i]},if(lt(mod(t,40),30),${chords[2][i]},${chords[3][i]})))`;
  const env = '(0.55+0.45*sin(PI*mod(t,10)/10))';
  const expr = `0.11*${env}*(sin(2*PI*${f(0)}*t)+0.8*sin(2*PI*${f(1)}*t)+0.7*sin(2*PI*${f(2)}*t)+0.3*sin(PI*${f(0)}*t))`;
  return ff(['-f', 'lavfi', '-i', `aevalsrc='${expr}|${expr}':s=44100:d=40`, '-af', 'afade=t=in:d=1,afade=t=out:st=38:d=2,lowpass=f=2500', '-c:a', 'aac', '-b:a', '128k', file]);
};

export function demoRoutes({ pool, tx, adminUser, HttpError }) {
  return {
    'POST /api/shorts/demo': async req => {
      const u = await adminUser(req);
      if (!hasFfmpeg) throw new HttpError(503, '서버에 영상 도구(ffmpeg)가 없어 예시 소재를 만들 수 없습니다 (bash server/deploy/update.sh)');
      // ③ 소재: 이미 만든 예시가 있으면 다시 씀
      const { rows: old } = await pool.query("SELECT * FROM jcal.shorts_assets WHERE user_id = $1 AND source = 'demo' ORDER BY name", [u.id]);
      const have = old.filter(a => fs.existsSync(assetFile(a)));
      await fsp.mkdir(path.join(ROOT, u.id), { recursive: true });
      const make = async (kind, name, ext, tags, build) => {
        const ex = have.find(a => a.name === name);
        if (ex) return ex;
        const id = crypto.randomUUID(), a = { id, user_id: u.id, ext };
        await build(assetFile(a));
        if (kind === 'image') await ff(['-i', assetFile(a), '-vf', 'scale=-2:360', '-q:v', '5', assetFile(a, 'thumb')]).catch(() => {});
        const meta = kind === 'music' ? await probe(assetFile(a)) : { width: 1080, height: 1920, duration: null };
        const size = (await fsp.stat(assetFile(a))).size;
        return (await pool.query(`INSERT INTO jcal.shorts_assets (id, user_id, kind, name, ext, mime, size_bytes, width, height, duration, tags, source, credit, has_thumb)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'demo', 'Jcalender 예시', $12) RETURNING *`,
        [id, u.id, kind, name, ext, kind === 'music' ? 'audio/mp4' : 'image/jpeg', size, meta.width ?? null, meta.height ?? null, meta.duration ?? null, tags, kind === 'image' && fs.existsSync(assetFile(a, 'thumb'))])).rows[0];
      };
      const bgs = [];
      for (const g of BGS) bgs.push(await make('image', g.name, 'jpg', g.tags, f => gradient(g, f)));
      const mu = await make('music', '예시 음악 · 잔잔한 화음', 'm4a', '예시 잔잔 웃김', music);
      // ① ② ④ 글 · 스크립트 · 제작 준비 (예시 글의 스크립트는 새로 씀)
      const out = await tx(async c => {
        const { rows: [it] } = await c.query(`INSERT INTO jcal.shorts_items (user_id, link, title, body, published_at, status) VALUES ($1, $2, $3, $4, now(), 'picked')
          ON CONFLICT (user_id, link) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, status = 'picked' RETURNING id`,
        [u.id, LINK, '[예시] 회의 중 팀장님의 7시 출근 선언, 그 뒤 반전', BODY]);
        await c.query('DELETE FROM jcal.shorts_scripts WHERE item_id = $1', [it.id]);
        let chosen = null;
        for (const s of SCRIPTS) {
          const { rows: [r] } = await c.query(`INSERT INTO jcal.shorts_scripts (user_id, item_id, title, script, hashtags, chosen, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, '예시 (AI 사용 안 함)', clock_timestamp()) RETURNING id`,
            [u.id, it.id, s.title, s.script, s.hashtags, s.chosen]);
          if (s.chosen) chosen = r.id;
        }
        await c.query(`INSERT INTO jcal.shorts_projects (user_id, script_id, backgrounds, music_id, keywords, mood) VALUES ($1, $2, $3, $4, $5, $6)`,
          [u.id, chosen, bgs.map(b => b.id), mu.id, 'office meeting, early morning commute, sunset city', '웃김']);
        return { itemId: it.id, scriptId: chosen };
      });
      return { ...out, assets: bgs.length + 1 };
    },
  };
}
