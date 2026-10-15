/* Agenda Josi — versão Supabase (multi-profissional).
 * Preserva toda a experiência e identidade visual original.
 * Troca: localStorage → tabelas public.appointments / clients / services.
 */
(() => {
  'use strict';

  const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DAY_NAMES = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
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
  let workingHours = [];
  let blockedDates = [];
  let servicesError = null;

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
  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }
  function normTime(t) {
    return String(t || '').slice(0, 5);
  }
  function currentService() {
    return services.find((item) => item.id === serviceSelect.value) || null;
  }
  function availableSlots(date, duration = 60) {
    const schedule = workingHours.find((item) => Number(item.weekday) === parseISO(date).getDay());
    if (!window.JosiBookingLogic || !schedule) return [];
    return window.JosiBookingLogic.availableSlots({
      date,
      schedule,
      appointments,
      durationMin: duration,
      blocked: blocked || blockedDates.some((item) => item.data === date),
      now: new Date(),
    });
  }
  function appointmentsInMonth(items, month) {
    return items.filter((item) => item.data.startsWith(month)).sort((a, b) => a.data.localeCompare(b.data) || a.horario.localeCompare(b.horario));
  }
  function forMonth() {
    return appointmentsInMonth(appointments, shownMonth);
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
    const duration = currentService()?.duracao_min || 60;
    $('#next-count').textContent = String(availableSlots(selectedDate, duration).length);
  }
  function summarizeAppointments(items) {
    const total = items.reduce((sum, item) => sum + (Number(item.valorCobrado) || 0), 0);
    const totalsByService = new Map();
    items.forEach((item) => {
      const name = item.servico || 'Procedimento não identificado';
      const current = totalsByService.get(name) || { count: 0, total: 0 };
      current.count += 1;
      current.total += Number(item.valorCobrado) || 0;
      totalsByService.set(name, current);
    });
    const procedures = [...totalsByService.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0], 'pt-BR'));
    return { count: items.length, total, average: items.length ? total / items.length : 0, procedures };
  }
  function renderBilling() {
    const summary = summarizeAppointments(forMonth());
    const [year, month] = shownMonth.split('-').map(Number);
    $('#billing-month').textContent = `${MONTHS[month - 1].replace(/^./, (letter) => letter.toUpperCase())} ${year}`;
    $('#billing-total').textContent = formatCurrency(summary.total);
    $('#billing-count').textContent = String(summary.count);
    $('#billing-average').textContent = formatCurrency(summary.average);

    const list = $('#procedure-revenue-list');
    const procedures = summary.procedures;
    $('#procedure-revenue-count').textContent = procedures.length ? `${procedures.length} ${procedures.length === 1 ? 'procedimento' : 'procedimentos'}` : '';
    list.replaceChildren();
    if (!procedures.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhum atendimento neste mês.';
      list.append(empty);
      return;
    }
    procedures.forEach(([name, summary]) => {
      const row = document.createElement('article');
      row.className = 'procedure-revenue-item';
      const main = document.createElement('div');
      main.className = 'procedure-revenue-main';
      const title = document.createElement('strong');
      title.textContent = name;
      const count = document.createElement('span');
      count.textContent = `${summary.count} ${summary.count === 1 ? 'atendimento' : 'atendimentos'}`;
      const value = document.createElement('strong');
      value.className = 'procedure-revenue-value';
      value.textContent = formatCurrency(summary.total);
      main.append(title, count);
      row.append(main, value);
      list.append(row);
    });
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
    const duration = currentService()?.duracao_min || 60;
    const freeSlots = availableSlots(selectedDate, duration);
    const entries = [
      ...booked.map((item) => ({ time: item.horario, item })),
      ...freeSlots.map((time) => ({ time, item: null })),
    ].sort((a, b) => a.time.localeCompare(b.time));
    entries.forEach(({ time: slot, item }) => {
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
    const dateBlocked = blockedDates.some((item) => item.data === selectedDate);
    const schedule = workingHours.find((item) => Number(item.weekday) === parseISO(selectedDate).getDay());
    help.textContent = blocked
      ? 'Agenda pausada. Fale com o administrador para reativar.'
      : dateBlocked
        ? 'Esta data está bloqueada e não aceita novos agendamentos.'
        : !schedule?.ativo
          ? 'Não há expediente configurado para este dia.'
          : !freeSlots.length
            ? (booked.length ? 'Não há horários livres para a duração deste procedimento.' : 'Não há horários disponíveis neste dia.')
            : `Toque em um horário livre. A disponibilidade considera ${duration} minutos por atendimento.`;
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
      const value = document.createElement('span');
      value.className = 'appointment-value';
      value.textContent = formatCurrency(item.valorCobrado);
      if (!(Number(item.valorCobrado) > 0)) {
        const note = document.createElement('small');
        note.className = 'appointment-value-note';
        note.textContent = 'sem valor histórico';
        value.append(note);
      }
      main.append(name, sub, value);
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
    prompt.textContent = services.length ? 'Selecione um procedimento' : 'Nenhum procedimento disponível';
    serviceSelect.append(prompt);
    services.forEach((service) => {
      const o = document.createElement('option');
      o.value = service.id;
      const suffix = service.nome.toLocaleLowerCase('pt-BR') === 'unhas decoradas' ? ' o par' : '';
      o.textContent = `${service.nome} — ${formatCurrency(service.preco)}${suffix} · ${service.duracao_min} min`;
      serviceSelect.append(o);
    });
    if (services.some((service) => service.id === current)) serviceSelect.value = current;
    serviceSelect.disabled = !services.length || blocked;
    updateServicePrice();
  }
  function updateServicePrice() {
    const service = currentService();
    const price = $('#service-price');
    if (!service) {
      price.textContent = servicesError ? 'Não foi possível carregar os procedimentos' : 'Selecione um procedimento';
      return;
    }
    const suffix = service.nome.toLocaleLowerCase('pt-BR') === 'unhas decoradas' ? ' o par' : '';
    price.textContent = `${formatCurrency(service.preco)}${suffix} · ${service.duracao_min} min`;
  }
  function refreshTimeChoices(preferred = '') {
    const date = dateInput.value;
    timeInput.replaceChildren();
    const available = date ? availableSlots(date, currentService()?.duracao_min || 60) : [];
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
    renderBilling();
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
      .select('id, nome, preco, duracao_min')
      .eq('professional_id', professional.id)
      .eq('ativo', true)
      .order('nome');
    servicesError = error || null;
    if (error) {
      services = [];
      showSync('Não foi possível carregar os procedimentos: ' + error.message);
    } else {
      services = (data || []).filter((service) => service.preco !== null && Number.isFinite(Number(service.preco)))
        .map((service) => ({ ...service, duracao_min: Number(service.duracao_min) || 60 }));
    }
    renderServices();
    form.querySelector('button[type="submit"]').disabled = blocked || !services.length;
  }

  async function loadAppointments() {
    const [from, to] = monthRange(shownMonth);
    const { data, error } = await supabase
      .from('appointments')
      .select('id, cliente_nome, telefone, servico, service_id, duracao_min, valor_cobrado, data, horario, observacoes')
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
      duracao_min: Number(r.duracao_min) || 60,
      valorCobrado: Number(r.valor_cobrado) || 0,
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

  function renderWorkingHours() {
    const root = $('#weekly-hours');
    root.replaceChildren();
    DAY_NAMES.forEach((day, weekday) => {
      const schedule = workingHours.find((item) => Number(item.weekday) === weekday) || {
        weekday, ativo: weekday >= 1 && weekday <= 6, inicio: '08:00', fim: '18:00',
        intervalo_min: 150, pausa_inicio: null, pausa_fim: null,
      };
      const row = document.createElement('div');
      row.className = 'week-row';
      row.dataset.weekday = String(weekday);

      const checkLabel = document.createElement('label');
      checkLabel.className = 'week-day-check';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.role = 'active';
      check.checked = Boolean(schedule.ativo);
      check.disabled = blocked;
      const dayName = document.createElement('span');
      dayName.textContent = day;
      checkLabel.append(check, dayName);
      row.append(checkLabel);

      const fields = [
        ['Abre', 'start', 'time', normTime(schedule.inicio) || '08:00'],
        ['Fecha', 'end', 'time', normTime(schedule.fim) || '18:00'],
        ['Intervalo (min)', 'interval', 'number', String(schedule.intervalo_min || 150)],
        ['Pausa começa', 'break-start', 'time', normTime(schedule.pausa_inicio)],
        ['Pausa termina', 'break-end', 'time', normTime(schedule.pausa_fim)],
      ];
      fields.forEach(([labelText, role, type, value]) => {
        const label = document.createElement('label');
        label.className = 'field';
        const text = document.createElement('span');
        text.textContent = labelText;
        const input = document.createElement('input');
        input.type = type;
        input.dataset.role = role;
        input.value = value;
        input.disabled = blocked;
        if (type === 'number') {
          input.min = '5'; input.max = '240'; input.step = '5'; input.required = true;
        }
        if (role === 'break-start' || role === 'break-end') input.setAttribute('aria-label', `${labelText} de ${day}`);
        label.append(text, input);
        row.append(label);
      });
      root.append(row);
    });
    $('#hours-form').querySelector('button[type="submit"]').disabled = blocked;
  }

  function renderBlockedDates() {
    const root = $('#blocked-date-list');
    root.replaceChildren();
    if (!blockedDates.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Nenhuma data bloqueada.';
      root.append(empty);
      return;
    }
    blockedDates.forEach((item) => {
      const row = document.createElement('article');
      row.className = 'blocked-date-item';
      const copy = document.createElement('div');
      copy.className = 'blocked-date-copy';
      const date = document.createElement('strong');
      date.textContent = formatDate(item.data);
      const reason = document.createElement('span');
      reason.textContent = item.motivo || 'Indisponível';
      copy.append(date, reason);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'blocked-date-remove';
      remove.textContent = 'Desbloquear';
      remove.disabled = blocked;
      remove.addEventListener('click', () => removeBlockedDate(item.id));
      row.append(copy, remove);
      root.append(row);
    });
  }

  function renderWhatsAppSettings() {
    $('#professional-whatsapp').value = professional?.telefone || '';
    $('#professional-whatsapp').disabled = blocked;
    $('#whatsapp-form').querySelector('button[type="submit"]').disabled = blocked;
  }

  async function loadAvailabilitySettings() {
    const [hoursResult, datesResult] = await Promise.all([
      supabase.from('professional_working_hours').select('*').eq('professional_id', professional.id).order('weekday'),
      supabase.from('professional_blocked_dates').select('id, data, motivo').eq('professional_id', professional.id)
        .gte('data', toISO(now)).order('data'),
    ]);
    if (hoursResult.error || datesResult.error) {
      workingHours = [];
      blockedDates = [];
      showSync('A configuração de horários precisa da migração 20261008_public_booking.sql no Supabase.');
    } else {
      workingHours = hoursResult.data || [];
      blockedDates = datesResult.data || [];
    }
    $('#blocked-date').min = toISO(now);
    renderWorkingHours();
    renderBlockedDates();
    refresh();
  }

  $('#hours-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#hours-status');
    message.textContent = '';
    if (blocked) { message.textContent = 'A agenda está em modo de leitura.'; return; }
    const rows = [...$('#weekly-hours').querySelectorAll('.week-row')].map((row) => {
      const value = (role) => row.querySelector(`[data-role="${role}"]`).value;
      const pauseStart = value('break-start') || null;
      const pauseEnd = value('break-end') || null;
      const start = value('start');
      const end = value('end');
      const interval = Number(value('interval'));
      const startMinute = window.JosiBookingLogic.timeToMinutes(start);
      const endMinute = window.JosiBookingLogic.timeToMinutes(end);
      const pauseStartMinute = pauseStart ? window.JosiBookingLogic.timeToMinutes(pauseStart) : null;
      const pauseEndMinute = pauseEnd ? window.JosiBookingLogic.timeToMinutes(pauseEnd) : null;
      if (!Number.isInteger(interval) || interval < 5 || interval > 240 || interval % 5 !== 0 || startMinute === null || endMinute === null || startMinute >= endMinute) {
        return { invalid: true, weekday: row.dataset.weekday };
      }
      if ((pauseStart === null) !== (pauseEnd === null)
          || (pauseStartMinute !== null && (pauseStartMinute < startMinute || pauseStartMinute >= pauseEndMinute || pauseEndMinute > endMinute))) {
        return { invalid: true, weekday: row.dataset.weekday };
      }
      return {
        ...(workingHours.find((item) => Number(item.weekday) === Number(row.dataset.weekday))?.id
          ? { id: workingHours.find((item) => Number(item.weekday) === Number(row.dataset.weekday)).id } : {}),
        professional_id: professional.id,
        weekday: Number(row.dataset.weekday),
        ativo: row.querySelector('[data-role="active"]').checked,
        inicio: start,
        fim: end,
        intervalo_min: interval,
        pausa_inicio: pauseStart,
        pausa_fim: pauseEnd,
      };
    });
    if (rows.some((row) => row.invalid)) {
      message.textContent = 'Confira os horários e a pausa. A pausa deve começar e terminar dentro do expediente.';
      return;
    }
    const button = $('#hours-form').querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error } = await supabase.from('professional_working_hours')
      .upsert(rows, { onConflict: 'professional_id,weekday' }).select('*').order('weekday');
    button.disabled = blocked;
    if (error) {
      message.textContent = 'Não foi possível salvar os horários. Confira a conexão e tente novamente.';
      return;
    }
    workingHours = data || rows;
    message.textContent = 'Horários de funcionamento salvos.';
    refresh();
  });

  $('#blocked-date-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#availability-status');
    message.textContent = '';
    const date = $('#blocked-date').value;
    if (blocked) { message.textContent = 'A agenda está em modo de leitura.'; return; }
    if (!date || date < toISO(now)) { message.textContent = 'Escolha uma data a partir de hoje.'; return; }
    const existing = blockedDates.find((item) => item.data === date);
    const payload = {
      ...(existing?.id ? { id: existing.id } : {}),
      professional_id: professional.id,
      data: date,
      motivo: $('#blocked-reason').value.trim(),
    };
    const { error } = await supabase.from('professional_blocked_dates')
      .upsert(payload, { onConflict: 'professional_id,data' });
    if (error) {
      message.textContent = 'Não foi possível bloquear essa data. Tente novamente.';
      return;
    }
    $('#blocked-date-form').reset();
    $('#blocked-date').min = toISO(now);
    await loadAvailabilitySettings();
    $('#availability-status').textContent = 'Data bloqueada; ela não aparecerá para novas reservas.';
  });

  async function removeBlockedDate(id) {
    const { error } = await supabase.from('professional_blocked_dates').delete()
      .eq('id', id).eq('professional_id', professional.id);
    if (error) { $('#availability-status').textContent = 'Não foi possível desbloquear essa data.'; return; }
    await loadAvailabilitySettings();
    $('#availability-status').textContent = 'Data desbloqueada.';
  }

  $('#whatsapp-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = $('#whatsapp-status');
    const value = $('#professional-whatsapp').value.trim();
    const digits = value.replace(/\D/g, '');
    const button = $('#whatsapp-form').querySelector('button[type="submit"]');
    message.textContent = '';
    if (blocked) { message.textContent = 'A agenda está em modo de leitura.'; return; }
    if (digits.length < 10 || digits.length > 15) {
      message.textContent = 'Informe um WhatsApp válido com DDD e código do país, se necessário.';
      return;
    }
    button.disabled = true;
    try {
      const { error } = await supabase.from('professionals')
        .update({ telefone: value }).eq('id', professional.id);
      if (error) {
        message.textContent = 'Não foi possível salvar o WhatsApp. Tente novamente.';
        return;
      }
      professional.telefone = value;
      message.textContent = 'Número salvo. As próximas reservas abrirão uma mensagem pronta para a Josi.';
    } catch {
      message.textContent = 'Não foi possível salvar o WhatsApp. Confira a conexão e tente novamente.';
    } finally {
      button.disabled = blocked;
    }
  });

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
  $('#billing-previous-month').addEventListener('click', () => changeMonth(-1));
  $('#billing-next-month').addEventListener('click', () => changeMonth(1));
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
  serviceSelect.addEventListener('change', () => {
    updateServicePrice();
    updateHeader();
    renderDayDetail();
    refreshTimeChoices();
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
    const serviceId = String(values.get('servico') || '').trim();
    const service = services.find((item) => item.id === serviceId);
    const data = String(values.get('data') || '');
    const horario = String(values.get('horario') || '');
    const telefone = String(values.get('telefone') || '').trim();
    const observacoes = String(values.get('observacoes') || '').trim();
    if (!nome || !service || !data || !availableSlots(data, service.duracao_min).includes(horario)) {
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
      const { error } = await supabase.from('appointments').insert({
        professional_id: professional.id,
        client_id: clientId,
        cliente_nome: nome,
        telefone,
        servico: service.nome,
        service_id: service.id,
        data,
        horario: `${horario}:00`,
        observacoes,
      });
      if (error) {
        formMessage.textContent = ['23505', '23P01'].includes(error.code)
          ? 'Esse horário acabou de ser reservado. Escolha outro horário.'
          : 'Não foi possível salvar: ' + error.message;
        return;
      }
      selectedDate = data;
      shownMonth = data.slice(0, 7);
      form.reset();
      updateServicePrice();
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
        $('#auth-gate-title').textContent = 'Painel temporariamente indisponível.';
        $('#auth-gate-message').textContent = 'A conexão do sistema não está configurada. Fale com a administradora.';
        $('#auth-gate-login').hidden = false;
        return;
      }
      if (e.message !== 'Sessão necessária.') {
        $('#auth-gate-title').textContent = 'Não foi possível carregar o painel.';
        $('#auth-gate-message').textContent = 'Verifique sua conexão e entre novamente.';
        $('#auth-gate-login').hidden = false;
      }
      return; // redirecionado para login
    }
    let ctx;
    try {
      ctx = await window.JosiSupabase.loadContext(supabase);
    } catch {
      $('#auth-gate-title').textContent = 'Não foi possível verificar seu acesso.';
      $('#auth-gate-message').textContent = 'Entre novamente para abrir o painel da agenda.';
      $('#auth-gate-login').hidden = false;
      return;
    }
    if (ctx.profile && ctx.profile.role === 'administrador') {
      window.location.href = '../admin/';
      return;
    }
    if (!ctx.profile) {
      $('#auth-gate-title').textContent = 'Acesso não autorizado.';
      $('#auth-gate-message').textContent = 'Esta conta não possui um perfil liberado para o painel.';
      $('#auth-gate-login').hidden = false;
      return;
    }
    professional = ctx.professional;
    subscription = ctx.subscription;
    if (!professional) {
      $('#auth-gate-title').textContent = 'Agenda não vinculada a esta conta.';
      $('#auth-gate-message').textContent = 'Peça à administradora para vincular seu usuário à profissional correta.';
      $('#auth-gate-login').hidden = false;
      return;
    }
    $('#auth-gate').hidden = true;
    $('#page-shell').hidden = false;
    // Barra de sessão (nome + plano/vencimento).
    sessBar.hidden = false;
    sessProf.textContent = `${professional.nome} · ${professional.especialidade || ''}`.trim();
    sessSub.textContent = subscription
      ? `${subscription.plans ? subscription.plans.nome + ' · ' : ''}vence em ${subscription.vencimento}`
      : 'Sem assinatura vinculada';
    // Personaliza marca com a profissional (sem duplicar o projeto).
    const brandName = document.querySelector('.brand-copy strong');
    if (brandName && professional.nome) brandName.textContent = professional.nome;

    const block = window.JosiSupabase.accessBlocked(professional, subscription);
    blocked = block.blocked;
    renderWhatsAppSettings();
    if (blocked) {
      showSync(block.reason + ' A agenda está em modo leitura.');
      form.querySelector('button[type="submit"]').disabled = true;
    }
    await loadServices();
    await loadAvailabilitySettings();
    await loadAppointments();
    subscribeRealtime();
  })();
})();
