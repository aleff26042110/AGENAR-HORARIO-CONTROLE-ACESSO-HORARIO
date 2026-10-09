import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { availableSlots } = require('../js/booking-logic.js');
const publicApp = fs.readFileSync(new URL('../agendar/app.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261008_public_booking.sql', import.meta.url), 'utf8');
const whatsappMigration = fs.readFileSync(new URL('../supabase/migrations/20261008_whatsapp_confirmation.sql', import.meta.url), 'utf8');
const phoneMigration = fs.readFileSync(new URL('../supabase/migrations/20261008_whatsapp_josi_phone.sql', import.meta.url), 'utf8');
const schedule = { ativo: true, inicio: '09:00:00', fim: '18:00:00', intervalo_min: 30, pausa_inicio: null, pausa_fim: null };

test('gera inícios em intervalos definidos e respeita a duração até o fechamento', () => {
  const slots = availableSlots({ date: '2099-10-08', schedule, durationMin: 60 });
  assert.equal(slots[0], '09:00');
  assert.equal(slots.at(-1), '17:00');
  assert.equal(slots.length, 17);
});

test('remove horários que cruzam uma pausa de almoço', () => {
  const slots = availableSlots({
    date: '2099-10-08',
    schedule: { ...schedule, pausa_inicio: '12:00:00', pausa_fim: '14:00:00' },
    durationMin: 60,
  });
  assert.ok(!slots.includes('11:30'));
  assert.ok(!slots.includes('12:00'));
  assert.ok(!slots.includes('13:30'));
  assert.ok(slots.includes('14:00'));
});

test('remove todos os inícios que se sobrepõem a um atendimento existente', () => {
  const slots = availableSlots({
    date: '2099-10-08',
    schedule,
    durationMin: 60,
    appointments: [{ data: '2099-10-08', horario: '14:00:00', duracao_min: 60 }],
  });
  assert.ok(!slots.includes('13:30'));
  assert.ok(!slots.includes('14:00'));
  assert.ok(!slots.includes('14:30'));
  assert.ok(slots.includes('15:00'));
});

test('não gera horários em dias desativados, bloqueados ou que já passaram', () => {
  const now = new Date(2099, 9, 8, 12, 0);
  assert.deepEqual(availableSlots({ date: '2099-10-08', schedule: { ...schedule, ativo: false }, now }), []);
  assert.deepEqual(availableSlots({ date: '2099-10-08', schedule, blocked: true, now }), []);
  assert.deepEqual(availableSlots({ date: '2099-10-07', schedule, now }), []);
});

test('em hoje, não oferece inícios anteriores ou iguais à hora atual', () => {
  const now = new Date(2099, 9, 8, 12, 15);
  const slots = availableSlots({ date: '2099-10-08', schedule, durationMin: 30, now });
  assert.ok(!slots.includes('12:00'));
  assert.ok(slots.includes('12:30'));
  assert.ok(slots.includes('13:00'));
});

test('a página pública usa apenas RPCs e não lê tabelas privadas diretamente', () => {
  assert.doesNotMatch(publicApp, /\.from\s*\(/);
  assert.match(publicApp, /rpc\('get_public_professional'/);
  assert.match(publicApp, /rpc\('get_public_services'/);
  assert.match(publicApp, /rpc\('get_public_available_slots'/);
  assert.match(publicApp, /rpc\('create_public_booking'/);
});

test('o banco restringe o acesso anônimo às tabelas e serializa reservas concorrentes', () => {
  assert.match(migration, /revoke all on public\.profiles[\s\S]*?from public, anon/i);
  assert.match(migration, /pg_advisory_xact_lock/g);
  assert.match(migration, /create trigger trg_appointments_overlap_guard/i);
  assert.match(migration, /grant execute on function public\.create_public_booking[\s\S]*?to anon, authenticated/i);
  assert.doesNotMatch(migration, /grant\s+[^;]*\bon\s+public\.appointments\s+to\s+anon/i);
});

test('a confirmação monta um link direto para o WhatsApp público da profissional', () => {
  assert.match(whatsappMigration, /'whatsapp'[\s\S]*?regexp_replace\(coalesce\(p\.telefone/i);
  assert.match(publicApp, /https:\/\/wa\.me\/\$\{whatsapp\}/);
  assert.match(publicApp, /link\.href = url\.toString\(\)/);
  assert.match(publicApp, /link\.hidden = false/);
  assert.match(publicApp, /Meu WhatsApp:/);
  assert.match(publicApp, /Observações:/);
});

test('a migração configura somente o telefone do slug público josi', () => {
  assert.match(phoneMigration, /set telefone = '12 98884-8361'/);
  assert.match(phoneMigration, /where public_slug = 'josi'/);
  assert.match(phoneMigration, /if v_josi_count <> 1 then/i);
});
