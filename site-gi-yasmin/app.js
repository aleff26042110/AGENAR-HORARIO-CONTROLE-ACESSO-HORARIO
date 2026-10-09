/* Agenda Gi — versão Supabase (multi-profissional).
 * Preserva toda a experiência e identidade visual original.
 * Troca: localStorage → tabelas public.appointments / clients / services.
 */
(() => {
  'use strict';

  const SLOTS = Array.from({ length: 10 }, (_, index) => `${String(index + 9).padStart(2, '0')}:00`);
  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const FALLBACK_SERVICES = [
    'Design de sobrancelhas',
    'Brow lamination',
    'Micropigmentação',
    'Extensão de cílios',
    'Lash lifting',
    'Manutenção de cílios',
  ];
  const $ = (selector) => document.querySelector(selector);

  const grid = $('#calendar-grid');
  const monthPicker = $('#month-picker');
  const dateInput = $('#booking-date');
  const timeInput = $('#booking-time');
  const form = $('#booking-form');
  const serviceSelect = form.querySelector('[name="servico"]');
  const sessBar = $('#sess-bar'), sessProf = $('#sess-prof'), sessSub = $('#sess-sub');
  const syncBar = $('#sync-bar');

  let supabase = null;
  let professional = null;
  let subscription = null;
  let blocked = false;
  let appointments = []; // {id, nome, servico, telefone, data, horario, observacoes}
  let services = [];

  const now = new Date();
  let shownMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let selectedDate = toISO(now);
  let toastTimer;

  // ---------- utils (idênticos ao original) ----------
  function toISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function parseISO(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
  }
  function formatDate(value, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
    return new Intl.DateTimeFormat('pt-BR', options).format(parseISO(value));
  }
  function normTime(t) {
    return String(t || '').slice(0, 5);
  }
  function forMonth() {
    return appointments.filter((item) => item.data.startsWith(shownMonth)).sort((a, b) => a.data.localeCompare(b.data) || a.horario.localeCompare(b.horario));
  }
  function dayAppointments(date) {
    return appointments.filter((item) => item.data === date).sort((a, b) => a.horario.localeCompare(b.horario));
  }
  function showSync(t) {
    if (!t) { syncBar.hidden = true; syncBar.textContent = ''; return; }
    syncBar.hidden = false;
    syncBar.textContent = t;
  }

  // ---------- render (mesma estrutura do original) ----------
  function updateHeader() {
    monthPicker.value = shownMonth;
    const [year, month] = shownMonth.split('-').map(Number);
    $('#month-label').textContent = `${MONTHS[month - 1].replace(/^./, (letter) => letter.toUpperCase())} ${year}`;
    $('#month-count').textContent = String(forMonth().length);
    $('#list-total').textContent = String(forMonth().length);
    const busy = new Set(dayAppointments(selectedDate).map((item) => item.horario));
    $('#next-count').textContent = String(SLOTS.length - busy.size);
  }
  function addDayCell(label, className = 'weekday', date = '') {
    const element = date ? document.createElement('button') : document.createElement('span');
    element.className = className;
    element.textContent = label;
    if (date) {
      element.type = 'button';
      element.dataset.date = date;
      element.setAttribute('aria-label', `${formatDate(date)}, ${dayAppointments(date).length} agendamentos`);
      element.setAttribute('aria-pressed', String(date === selectedDate));
      const number = document.createElement('span');
      number.className = 'day-number';
      number.textContent = String(parseISO(date).getDate());
      element.replaceChildren(number);
      const count = dayAppointments(date).length;
      if (count) {
        element.classList.add('has-appointments');
        const dot = document.createElement('i');
        dot.className = 'day-dot';
        dot.setAttribute('aria-hidden', 'true');
        element.append(dot);
      }
      if (date === selectedDate) element.classList.add('selected');
      if (date === toISO(now)) element.classList.add('today');
      grid.append(element);
    } else grid.append(element);
  }
  function renderCalendar() {
    grid.replaceChildren();
    WEEKDAYS.slice(1).concat(WEEKDAYS[0]).forEach((day) => addDayCell(day));
    const [year, month] = shownMonth.split('-').map(Number);
    const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
    const totalDays = new Date(year, month, 0).getDate();
    for (let index = 0; index < firstWeekday; index += 1) {
      const blank = document.createElement('span');
      blank.className = 'day-cell other-month';
      blank.setAttribute('aria-hidden', 'true');
      grid.append(blank);
    }
    for (let day = 1; day <= totalDays; day += 1) {
      const date = `${shownMonth}-${String(day).padStart(2, '0')}`;
      addDayCell(String(day), 'day-cell', date);
    }
    renderDayDetail();
  }
  function renderDayDetail() {
    const detail = $('#day-detail');
    detail.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'day-detail-heading';
    const title = document.createElement('strong');
    title.textContent = formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' });
    const summary = document.createElement('span');
    const booked = dayAppointments(selectedDate);
    summary.textContent = `${booked.length} ${booked.length === 1 ? 'atendimento' : 'atendimentos'}`;
    heading.append(title, summary);
    const chips = document.createElement('div');
    chips.className = 'slot-chips';
    const busy = new Map(booked.map((item) => [item.horario, item]));
    SLOTS.forEach((slot) => {
      const item = busy.get(slot);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `slot-chip ${item ? 'booked' : 'free'}`;
      chip.textContent = item ? `${slot} · ${item.nome}` : `${slot} · livre`;
      chip.disabled = Boolean(item) || blocked;
      if (!item && !blocked) chip.addEventListener('click', () => {
        dateInput.value = selectedDate;
        refreshTimeChoices(slot);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        timeInput.focus({ preventScroll: true });
      });
      chips.append(chip);
    });
    const help = document.createElement('p');
    help.className = 'slot-help';
    help.textContent = blocked
      ? 'Agenda pausada. Fale com o administrador para reativar.'
      : 'Toque em um horário livre para preencher o agendamento.';
    detail.append(heading, chips, help);
  }
  function renderAppointments() {
    const list = $('#appointments-list');
    list.replaceChildren();
    const items = forMonth();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhum atendimento neste mês. Seus novos agendamentos aparecerão aqui.';
      list.append(empty);
      return;
    }
    items.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'appointment-item';
      const avatar = document.createElement('span');
      avatar.className = 'appointment-avatar';
      avatar.textContent = (item.nome || '?').trim().charAt(0) || '?';
      const main = document.createElement('div');
      main.className = 'appointment-main';
      const name = document.createElement('strong');
      name.className = 'appointment-name';
      name.textContent = item.nome;
      const sub = document.createElement('p');
      sub.className = 'appointment-sub';
      sub.textContent = `${formatDate(item.data, { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${item.servico}`;
      main.append(name, sub);
      if (item.telefone || item.observacoes) {
        const extra = document.createElement('p');
        extra.className = 'appointment-sub';
        extra.textContent = [item.telefone, item.observacoes].filter(Boolean).join(' · ');
        main.append(extra);
      }
      const actions = document.createElement('div');
      actions.className = 'appointment-actions';
      const time = document.createElement('span');
      time.className = 'appointment-time';
      time.textContent = item.horario;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-button';
      remove.textContent = 'Remover';
      remove.disabled = blocked;
      remove.setAttribute('aria-label', `Remover agendamento de ${item.nome} às ${item.horario}`);
      remove.addEventListener('click', () => deleteAppointment(item.id));
      actions.append(time, remove);
      row.append(avatar, main, actions);
      list.append(row);
    });
  }
  function renderServices() {
    const current = serviceSelect.value;
    serviceSelect.replaceChildren();
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = 'Selecione um serviço';
    serviceSelect.append(prompt);
    const names = services.length ? services.map((s) => s.nome) : FALLBACK_SERVICES;
    names.forEach((n) => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      serviceSelect.append(o);
    });
    if (names.includes(current)) serviceSelect.value = current;
  }
  function refreshTimeChoices(preferred = '') {
    const date = dateInput.value;
    timeInput.replaceChildren();
    const busy = new Set(dayAppointments(date).map((item) => item.horario));
    const available = SLOTS.filter((slot) => !busy.has(slot));
    const prompt = document.createElement('option');
    prompt.value = '';
    prompt.textContent = date ? (available.length ? 'Selecione um horário' : 'Dia sem horários livres') : 'Escolha a data';
    timeInput.append(prompt);
    available.forEach((slot) => {
      const option = document.createElement('option');
      option.value = slot;
      option.textContent = slot;
      timeInput.append(option);
    });
    timeInput.disabled = !date || !available.length || blocked;
    if (available.includes(preferred)) timeInput.value = preferred;
  }
  function refresh() {
    updateHeader();
    renderCalendar();
    renderAppointments();
    dateInput.value = selectedDate;
    refreshTimeChoices();
  }

  // ---------- Supabase ----------
  function monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`];
  }

  async function loadServices() {
    const { data, error } = await supabase
      .from('services')
      .select('id, nome')
      .eq('professional_id', professional.id)
      .eq('ativo', true)
      .order('nome');
    if (error) { services = []; }
    else services = data || [];
    renderServices();
  }

  async function loadAppointments() {
    const [from, to] = monthRange(shownMonth);
    const { data, error } = await supabase
      .from('appointments')
      .select('id, cliente_nome, telefone, servico, data, horario, observacoes')
      .eq('professional_id', professional.id)
      .gte('data', from)
      .lte('data', to)
      .order('data')
      .order('horario');
    if (error) {
      showSync('Não foi possível carregar a agenda: ' + error.message);
      return;
    }
    appointments = (data || []).map((r) => ({
      id: r.id,
      nome: r.cliente_nome || '',
      servico: r.servico || '',
      telefone: r.telefone || '',
      data: r.data,
      horario: normTime(r.horario),
      observacoes: r.observacoes || '',
    }));
    refresh();
  }

  async function findOrCreateClient(nome, telefone, observacoes) {
    // Reaproveita cliente pelo telefone; senão cria.
    if (telefone) {
      const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('professional_id', professional.id)
        .eq('telefone', telefone)
        .limit(1)
        .maybeSingle();
      if (data) return data.id;
    }
    const { data, error } = await supabase
      .from('clients')
      .insert({ professional_id: professional.id, nome, telefone: telefone || '', observacoes: observacoes || '' })
      .select('id')
      .single();
    if (error) return null;
    return data.id;
  }

  async function deleteAppointment(id) {
    const item = appointments.find((a) => a.id === id);
    if (!item || !window.confirm(`Remover o agendamento de ${item.nome} às ${item.horario}?`)) return;
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) { showToast('Não foi possível remover: ' + error.message); return; }
    showToast('Agendamento removido da agenda.');
    await loadAppointments();
  }

  function subscribeRealtime() {
    supabase
      .channel(`agenda-${professional.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `professional_id=eq.${professional.id}` },
        () => loadAppointments())
      .subscribe();
  }

  // ---------- eventos (estrutura original) ----------
  grid.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-date]');
    if (!button) return;
    selectedDate = button.dataset.date;
    // Otimização: se trocou de mês implícito, recarrega do banco.
    const m = selectedDate.slice(0, 7);
    if (m !== shownMonth) { shownMonth = m; await loadAppointments(); }
    else refresh();
  });
  $('#previous-month').addEventListener('click', () => changeMonth(-1));
  $('#next-month').addEventListener('click', () => changeMonth(1));
  async function changeMonth(amount) {
    const [year, month] = shownMonth.split('-').map(Number);
    const changed = new Date(year, month - 1 + amount, 1);
    shownMonth = `${changed.getFullYear()}-${String(changed.getMonth() + 1).padStart(2, '0')}`;
    selectedDate = `${shownMonth}-01`;
    await loadAppointments();
  }
  monthPicker.addEventListener('change', async () => {
    if (!monthPicker.value) return;
    shownMonth = monthPicker.value;
    selectedDate = `${shownMonth}-01`;
    await loadAppointments();
  });
  dateInput.min = toISO(now);
  dateInput.value = selectedDate;
  dateInput.addEventListener('change', async () => {
    if (!dateInput.value) return;
    selectedDate = dateInput.value;
    const m = selectedDate.slice(0, 7);
    if (m !== shownMonth) { shownMonth = m; await loadAppointments(); }
    else refresh();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blocked) return;
    const formMessage = $('#form-message');
    formMessage.textContent = '';
    const values = new FormData(form);
    const nome = String(values.get('nome') || '').trim();
    const servico = String(values.get('servico') || '').trim();
    const data = String(values.get('data') || '');
    const horario = String(values.get('horario') || '');
    const telefone = String(values.get('telefone') || '').trim();
    const observacoes = String(values.get('observacoes') || '').trim();
    if (!nome || !servico || !data || !SLOTS.includes(horario)) {
      formMessage.textContent = 'Confira os campos obrigatórios e escolha uma data e horário.';
      return;
    }
    if (data < toISO(new Date())) {
      formMessage.textContent = 'Não é possível agendar em uma data que já passou.';
      return;
    }
    if (appointments.some((item) => item.data === data && item.horario === horario)) {
      formMessage.textContent = 'Esse horário já está reservado. Escolha outro horário.';
      refreshTimeChoices();
      return;
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const clientId = await findOrCreateClient(nome, telefone, observacoes);
      const svc = services.find((s) => s.nome === servico);
      const { error } = await supabase.from('appointments').insert({
        professional_id: professional.id,
        client_id: clientId,
        cliente_nome: nome,
        telefone,
        servico,
        service_id: svc ? svc.id : null,
        data,
        horario: `${horario}:00`,
        observacoes,
      });
      if (error) {
        formMessage.textContent = error.code === '23505'
          ? 'Esse horário acabou de ser reservado. Escolha outro horário.'
          : 'Não foi possível salvar: ' + error.message;
        return;
      }
      selectedDate = data;
      shownMonth = data.slice(0, 7);
      form.reset();
      await loadAppointments();
      showToast('Agendamento salvo com sucesso!');
    } finally {
      submitBtn.disabled = false;
    }
  });
  $('#clear-month').addEventListener('click', async () => {
    if (blocked) return;
    const monthItems = forMonth();
    if (!monthItems.length) {
      showToast('Não há agendamentos para limpar neste mês.');
      return;
    }
    if (!window.confirm(`Apagar os ${monthItems.length} agendamento(s) de ${$('#month-label').textContent}? Esta ação não pode ser desfeita.`)) return;
    const [from, to] = monthRange(shownMonth);
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('professional_id', professional.id)
      .gte('data', from)
      .lte('data', to);
    if (error) { showToast('Não foi possível limpar: ' + error.message); return; }
    await loadAppointments();
    showToast('Agenda do mês limpa.');
  });

  $('#btn-sair').addEventListener('click', async () => {
    if (supabase) await window.JosiSupabase.signOutAndGoLogin(supabase);
    else window.location.href = '../login/';
  });

  // ---------- boot ----------
  (async function boot() {
    try {
      const r = await window.JosiSupabase.init({ requireSession: true });
      supabase = r.supabase;
    } catch (e) {
      if (e.code === 'SUPABASE_NOT_CONFIGURED') {
        showSync('Conexão indisponível. Fale com a administradora do sistema.');
        refresh();
        return;
      }
      return; // redirecionado para login
    }
    const ctx = await window.JosiSupabase.loadContext(supabase, { agendaSlug: 'site-gi-yasmin' });
    if (ctx.profile && ctx.profile.role === 'administrador') {
      window.location.href = '../admin/';
      return;
    }
    professional = ctx.professional;
    subscription = ctx.subscription;
    if (!professional) {
      showSync('Este login não está vinculado ao cadastro da Gi. Use a conta da Gi ou configure o cadastro em supabase/gi-setup.sql.');
      refresh();
      return;
    }
    // Barra de sessão (nome + plano/vencimento).
    sessBar.hidden = false;
    sessProf.textContent = `Gi · ${professional.especialidade || ''}`.trim();
    sessSub.textContent = subscription
      ? `${subscription.plans ? subscription.plans.nome + ' · ' : ''}vence em ${subscription.vencimento}`
      : 'Sem assinatura vinculada';
    const block = window.JosiSupabase.accessBlocked(professional, subscription);
    blocked = block.blocked;
    if (blocked) {
      showSync(block.reason + ' A agenda está em modo leitura.');
      form.querySelector('button[type="submit"]').disabled = true;
    }
    await loadServices();
    await loadAppointments();
    subscribeRealtime();
  })();
})();
