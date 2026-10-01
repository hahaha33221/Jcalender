#!/usr/bin/env node
/* 앱 백업 파일(설정 › 백업 › 백업 파일 내려받기, jcalender_backup_YYYYMMDD.json) → PostgreSQL INSERT 문
   사용법:  node db/import-backup.mjs <백업.json> <이메일> [이름] > import.sql
           psql -d jcal -v ON_ERROR_STOP=1 -f import.sql
   - 사용자가 없으면 만들고(비밀번호는 server/admin.mjs 로 따로 설정), 있으면 그 사용자의 데이터를 갱신한다 (같은 id 는 덮어씀)
   - 한 트랜잭션으로 실행되어 중간에 실패하면 아무것도 바뀌지 않는다
   - 비밀 정보(API 키 · 토큰)는 백업 파일에 없으므로 옮기지 않는다
   - 변환 규칙은 db/convert.mjs (API 서버도 같은 규칙으로 표를 채운다) */
import fs from 'fs';
import { storeToSql } from './convert.mjs';

const [, , file, email, name = ''] = process.argv;
if (!file || !email) { console.error('사용법: node db/import-backup.mjs <백업.json> <이메일> [이름]'); process.exit(1); }
const { sql, counts: c } = storeToSql(JSON.parse(fs.readFileSync(file, 'utf8')), { email, name });
process.stdout.write(sql);
console.error(`변환 완료: 일정 ${c.events} · 인맥 ${c.people} · 기념일 ${c.anniv} · 지출 ${c.expenses} · 기획 ${c.plans} · 체크 ${c.done}`);
