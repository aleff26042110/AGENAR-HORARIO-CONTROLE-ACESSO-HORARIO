import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const app = fs.readFileSync(new URL('../site-josi/app.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261008_josi_billing.sql', import.meta.url), 'utf8');

const monthFilter = app.match(/function appointmentsInMonth\(items, month\) \{[\s\S]*?\n  \}/)?.[0];
const summary = app.match(/function summarizeAppointments\(items\) \{[\s\S]*?\n  \}\n  function renderBilling/)?.[0]?.replace(/\n  function renderBilling$/, '');
assert.ok(monthFilter && summary, 'The billing helpers must stay available in the Josi app.');
const { appointmentsInMonth, summarizeAppointments } = vm.runInNewContext(
  `${monthFilter};${summary};({ appointmentsInMonth, summarizeAppointments })`,
);

const blindagem = {
  nome: 'Maria', servico: 'Blindagem com esmaltação em gel', valorCobrado: 80,
  data: '2026-10-08', horario: '09:00',
};
const banho = {
  nome: 'Ana', servico: 'Banho de gel', valorCobrado: 120,
  data: '2026-10-08', horario: '10:00',
};
const banhoNovo = {
  nome: 'Joana', servico: 'Banho de gel', valorCobrado: 140,
  data: '2026-10-09', horario: '11:00',
};

test('1 atendimento: total, quantidade e ticket médio', () => {
  const result = summarizeAppointments([blindagem]);
  assert.equal(result.count, 1);
  assert.equal(result.total, 80);
  assert.equal(result.average, 80);
  assert.equal(result.procedures[0][0], 'Blindagem com esmaltação em gel');
  assert.equal(result.procedures[0][1].count, 1);
  assert.equal(result.procedures[0][1].total, 80);
});

test('2 atendimentos: soma e ticket médio', () => {
  const result = summarizeAppointments([blindagem, banho]);
  assert.equal(result.total, 200);
  assert.equal(result.count, 2);
  assert.equal(result.average, 100);
});

test('mudança de preço não altera o snapshot antigo; atendimento novo usa o valor salvo', () => {
  const currentServicePrice = 140;
  assert.equal(currentServicePrice, 140);
  assert.equal(banho.valorCobrado, 120);
  const result = summarizeAppointments([blindagem, banho, banhoNovo]);
  assert.equal(result.total, 340);
  assert.equal(result.count, 3);
  assert.equal(Number(result.average.toFixed(2)), 113.33);
});

test('excluir atendimento recalcula total, quantidade e ticket médio', () => {
  const result = summarizeAppointments([banho, banhoNovo]);
  assert.equal(result.total, 260);
  assert.equal(result.count, 2);
  assert.equal(result.average, 130);
});

test('mês selecionado inclui apenas os atendimentos do mês', () => {
  const result = appointmentsInMonth([
    blindagem,
    { ...banho, data: '2026-09-30' },
    banhoNovo,
  ], '2026-10');
  assert.deepEqual(result.map((item) => item.nome), ['Maria', 'Joana']);
});

test('migração mantém a lista de dez procedimentos e preços solicitados', () => {
  const block = migration.match(/for v_procedure in([\s\S]*?)\) as procedure_list/)?.[1];
  assert.ok(block, 'Migration must contain the procedure upsert list.');
  const entries = [...block.matchAll(/\('([^']+)'(?:::text)?\s*,\s*([0-9.]+)(?:::numeric)?\)/g)]
    .map(([, name, price]) => [name, Number(price)]);
  assert.deepEqual(entries, [
    ['Blindagem com esmaltação em gel', 80],
    ['Blindagem com esmaltação comum', 70],
    ['Apenas blindagem', 60],
    ['Banho de gel', 120],
    ['Alongamento em fibra de vidro + esmaltação em gel + 2 unhas decoradas', 180],
    ['Manutenção 15 dias após procedimento', 90],
    ['Manutenção 21 dias após procedimento', 120],
    ['Manutenção 31 dias após procedimento', 135],
    ['Reconstrução de unha', 10],
    ['Unhas decoradas', 10],
  ]);
});

test('migração não desativa RLS e preenche preço a partir de services.preco', () => {
  assert.match(migration, /new\.valor_cobrado\s*:=\s*v_service_price/);
  assert.match(migration, /create policy services_select_own/);
  assert.doesNotMatch(migration, /disable row level security/i);
  assert.doesNotMatch(app, /service_role/i);
});
