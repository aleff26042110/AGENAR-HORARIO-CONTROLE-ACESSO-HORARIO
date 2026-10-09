(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const form = $('#public-booking-form');
  const serviceSelect = $('#service-select');
  const serviceCatalog = $('#service-catalog');
  const dateInput = $('#date-input');
  const slotList = $('#slot-list');
  const selectedTimeInput = $('#selected-time');
  const confirmButton = $('#confirm-booking');
  const status = $('#form-status');
  const slug = new URLSearchParams(window.location.search).get('profissional') || 'josi';

  let supabase = null;
  let professional = null;
  let services = [];
  let selectedTime = '';
  let toastTimer = null;
  let slotRequestId = 0;
  const progressSteps = [...document.querySelectorAll('.step-progress li')];

  function updateStepProgress() {
    const activeStep = !selectedService() ? 0 : (!dateInput.value || !selectedTime ? 1 : 2);
    progressSteps.forEach((step, index) => {
      step.classList.toggle('step-active', index === activeStep);
      step.classList.toggle('step-complete', index < activeStep);
      if (index === activeStep) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
  }

  function localDateISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
  }

  function formatDate(value) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(year, month - 1, day));
  }

  function normalizeWhatsAppNumber(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits.length >= 12 && digits.length <= 15 ? digits : '';
  }

  function confirmationMessage(booking) {
    const lines = [
      `Oi, ${booking.professional_name || professional.nome}! Fiz um agendamento pelo site e gostaria de confirmar com você:`,
      '',
      `Cliente: ${booking.client_name}`,
      `Meu WhatsApp: ${booking.client_phone}`,
      `Procedimento: ${booking.service_name}`,
      `Data: ${formatDate(booking.appointment_date)}`,
      `Horário: ${String(booking.appointment_time).slice(0, 5)}`,
      `Valor: ${formatCurrency(booking.service_price)}`,
    ];
    const notes = $('#client-notes').value.trim();
    if (notes) lines.push(`Observações: ${notes}`);
    return lines.join('\n');
  }

  function selectedService() {
    return services.find((service) => service.service_id === serviceSelect.value) || null;
  }

  function normalizedServiceName(service) {
    return String(service.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  }

  function serviceCategory(service) {
    const name = normalizedServiceName(service);
    if (name.includes('blindagem')) return 'Blindagem';
    if (name.includes('banho de gel')) return 'Banho de gel';
    if (name.includes('alongamento') || name.includes('fibra de vidro')) return 'Alongamento';
    if (name.includes('manutenc')) return 'Manutenção';
    return 'Adicionais';
  }

  function servicePriceLabel(service) {
    const suffix = normalizedServiceName(service) === 'unhas decoradas' ? ' o par' : '';
    return `${formatCurrency(service.preco)}${suffix}`;
  }

  function showServiceCatalogMessage(message) {
    serviceCatalog.replaceChildren();
    serviceCatalog.setAttribute('aria-busy', 'false');
    const paragraph = document.createElement('p');
    paragraph.className = 'catalog-message';
    paragraph.textContent = message;
    serviceCatalog.append(paragraph);
  }

  function renderServiceCatalog() {
    serviceCatalog.replaceChildren();
    serviceCatalog.setAttribute('aria-busy', 'false');

    if (!services.length) {
      showServiceCatalogMessage('Os procedimentos não estão disponíveis no momento.');
      return;
    }

    const categoryOrder = ['Blindagem', 'Banho de gel', 'Alongamento', 'Manutenção', 'Adicionais'];
    const groups = new Map(categoryOrder.map((category) => [category, []]));
    services.forEach((service) => groups.get(serviceCategory(service)).push(service));

    categoryOrder.forEach((category) => {
      const categoryServices = groups.get(category);
      if (!categoryServices.length) return;

      const section = document.createElement('section');
      section.className = 'service-group';
      const heading = document.createElement('h3');
      heading.className = 'service-group-title';
      heading.textContent = category;
      const list = document.createElement('div');
      list.className = 'service-options';
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', category);

      categoryServices.forEach((service) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'service-choice';
        button.dataset.serviceId = service.service_id;
        button.setAttribute('aria-pressed', String(service.service_id === serviceSelect.value));

        const copy = document.createElement('span');
        copy.className = 'service-choice-copy';
        const name = document.createElement('strong');
        name.className = 'service-choice-name';
        name.textContent = service.nome;
        const duration = document.createElement('span');
        duration.className = 'service-choice-duration';
        duration.textContent = `Duração aproximada: ${service.duracao_min} min`;
        copy.append(name, duration);

        const price = document.createElement('span');
        price.className = 'service-choice-price';
        const amount = document.createElement('strong');
        amount.textContent = servicePriceLabel(service);
        const action = document.createElement('span');
        action.className = 'service-choice-action';
        action.textContent = service.service_id === serviceSelect.value ? 'Selecionado' : 'Escolher';
        price.append(amount, action);
        button.append(copy, price);

        button.addEventListener('click', async () => {
          serviceSelect.value = service.service_id;
          renderServiceCatalog();
          renderServiceSummary();
          updateStepProgress();
          await loadAvailableSlots();
        });
        list.append(button);
      });

      section.append(heading, list);
      serviceCatalog.append(section);
    });
  }

  function setStatus(message, isError = true) {
    status.textContent = message;
    status.classList.toggle('status-error', isError && Boolean(message));
  }

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove('visible'), 2600);
  }

  function renderServiceSummary() {
    const service = selectedService();
    const summary = $('#service-summary');
    summary.replaceChildren();
    if (!service) {
      summary.classList.remove('has-service');
      const message = document.createElement('span');
      message.textContent = services.length ? 'Selecione um procedimento para ver o valor e a duração.' : 'Os procedimentos não estão disponíveis no momento.';
      summary.append(message);
      return;
    }
    summary.classList.add('has-service');
    const detail = document.createElement('span');
    detail.textContent = `Duração aproximada: ${service.duracao_min} min`;
    const price = document.createElement('strong');
    price.textContent = servicePriceLabel(service);
    summary.append(detail, price);
  }

  function showSlotMessage(message) {
    slotList.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'slot-empty';
    empty.textContent = message;
    slotList.append(empty);
    $('#slot-hint').textContent = '';
  }

  function chooseTime(value) {
    selectedTime = value;
    selectedTimeInput.value = value;
    slotList.querySelectorAll('.slot-choice').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.time === value));
    });
    confirmButton.disabled = !selectedService() || !dateInput.value || !selectedTime;
    updateStepProgress();
  }

  async function loadAvailableSlots() {
    const requestId = ++slotRequestId;
    selectedTime = '';
    selectedTimeInput.value = '';
    confirmButton.disabled = true;
    updateStepProgress();
    const service = selectedService();
    const date = dateInput.value;
    if (!service || !date) {
      showSlotMessage('Escolha o procedimento e a data para consultar os horários.');
      return;
    }
    if (date < localDateISO()) {
      showSlotMessage('Escolha uma data a partir de hoje.');
      return;
    }

    slotList.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'slot-empty';
    loading.textContent = 'Consultando horários…';
    slotList.append(loading);
    $('#slot-hint').textContent = 'Pode levar alguns segundos';

    let data, error;
    try {
      ({ data, error } = await supabase.rpc('get_public_available_slots', {
        p_slug: slug,
        p_service_id: service.service_id,
        p_data: date,
      }));
    } catch {
      if (requestId !== slotRequestId) return;
      showSlotMessage('Não foi possível consultar essa data. Tente novamente.');
      return;
    }
    if (requestId !== slotRequestId) return;
    if (error) {
      showSlotMessage('Não foi possível consultar essa data. Tente novamente.');
      return;
    }
    const times = (data || []).map((row) => String(row.horario || '').slice(0, 5)).filter(Boolean);
    slotList.replaceChildren();
    if (!times.length) {
      showSlotMessage('Esse dia não possui horários disponíveis. Escolha outra data.');
      return;
    }
    $('#slot-hint').textContent = `${times.length} ${times.length === 1 ? 'horário livre' : 'horários livres'}`;
    times.forEach((time) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'slot-choice';
      button.dataset.time = time;
      button.textContent = time;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => chooseTime(time));
      slotList.append(button);
    });
  }

  function populateServices() {
    serviceSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = services.length ? 'Selecione um procedimento' : 'Nenhum procedimento disponível';
    serviceSelect.append(placeholder);
    services.forEach((service) => {
      const option = document.createElement('option');
      option.value = service.service_id;
      option.textContent = `${service.nome} — ${servicePriceLabel(service)}`;
      serviceSelect.append(option);
    });
    serviceSelect.disabled = !services.length;
    dateInput.disabled = !services.length;
    renderServiceCatalog();
    renderServiceSummary();
  }

  function renderConfirmation(booking) {
    form.hidden = true;
    $('.step-progress').hidden = true;
    $('#confirmation').hidden = false;
    const name = booking.professional_name || professional.nome;
    $('#confirmation-title').textContent = 'Agendamento confirmado!';
    const details = $('#confirmation-details');
    details.replaceChildren();
    const values = [
      ['Procedimento', booking.service_name],
      ['Valor', formatCurrency(booking.service_price) + (String(booking.service_name).toLocaleLowerCase('pt-BR') === 'unhas decoradas' ? ' o par' : '')],
      ['Data', formatDate(booking.appointment_date)],
      ['Horário', String(booking.appointment_time).slice(0, 5)],
      ['Cliente', booking.client_name],
      ['WhatsApp', booking.client_phone],
      ['Profissional', name],
    ];
    values.forEach(([label, value]) => {
      const wrapper = document.createElement('div');
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      wrapper.append(term, description);
      details.append(wrapper);
    });
    const whatsapp = normalizeWhatsAppNumber(professional.whatsapp);
    const link = $('#share-confirmation');
    const confirmationStatus = $('#confirmation-status');
    if (!whatsapp) {
      link.hidden = true;
      confirmationStatus.textContent = 'O WhatsApp da Josi ainda não está configurado. A reserva ficou registrada na agenda.';
      return;
    }
    const url = new URL(`https://wa.me/${whatsapp}`);
    url.searchParams.set('text', confirmationMessage({ ...booking, professional_name: name }));
    link.href = url.toString();
    link.hidden = false;
    confirmationStatus.textContent = 'Reserva salva. Para avisar a Josi, toque no botão abaixo e envie a mensagem.';
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('copy-failed');
  }

  async function loadPage() {
    try {
      const { supabase: client } = await window.JosiSupabase.init();
      supabase = client;
    } catch {
      showSlotMessage('A agenda está temporariamente indisponível. Tente novamente mais tarde.');
      serviceSelect.disabled = true;
      showServiceCatalogMessage('A agenda está temporariamente indisponível. Tente novamente mais tarde.');
      return;
    }

    let profileResult, servicesResult;
    try {
      [profileResult, servicesResult] = await Promise.all([
        supabase.rpc('get_public_professional', { p_slug: slug }),
        supabase.rpc('get_public_services', { p_slug: slug }),
      ]);
    } catch {
      showSlotMessage('Não foi possível carregar a agenda. Tente novamente mais tarde.');
      serviceSelect.disabled = true;
      dateInput.disabled = true;
      showServiceCatalogMessage('Não foi possível carregar os procedimentos. Tente novamente mais tarde.');
      return;
    }
    if (profileResult.error || servicesResult.error || !profileResult.data) {
      showSlotMessage('Não foi possível carregar a agenda. Tente novamente mais tarde.');
      serviceSelect.disabled = true;
      dateInput.disabled = true;
      showServiceCatalogMessage('Não foi possível carregar os procedimentos. Tente novamente mais tarde.');
      setStatus('A agenda pode não estar configurada para receber reservas públicas.');
      return;
    }

    professional = profileResult.data;
    services = (servicesResult.data || []).filter((service) => service.preco !== null && Number.isFinite(Number(service.preco)) && Number(service.duracao_min) > 0);
    $('#professional-name').textContent = professional.nome || 'Agenda online';
    $('#footer-professional').textContent = professional.nome || 'Agenda online';
    $('#professional-specialty').textContent = professional.especialidade || 'Escolha o procedimento e encontre o melhor horário para você.';
    $('#brand-mark').textContent = professional.marca || 'JM';
    document.title = `Agende seu horário · ${professional.nome || 'Agenda'}`;
    dateInput.min = localDateISO();
    populateServices();
    updateStepProgress();
    if (!services.length) setStatus('A profissional ainda não tem procedimentos disponíveis para agendamento.');
  }

  serviceSelect.addEventListener('change', async () => {
    renderServiceCatalog();
    renderServiceSummary();
    updateStepProgress();
    await loadAvailableSlots();
  });
  dateInput.addEventListener('change', async () => {
    updateStepProgress();
    await loadAvailableSlots();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const service = selectedService();
    const name = $('#client-name').value.trim();
    const phone = $('#client-phone').value.trim();
    const digits = phone.replace(/\D/g, '');
    if (!service) {
      setStatus('Selecione um procedimento.');
      serviceCatalog.querySelector('.service-choice')?.focus();
      return;
    }
    if (!dateInput.value || !selectedTime) { setStatus('Escolha uma data e um horário disponível.'); dateInput.focus(); return; }
    if (name.length < 2) { setStatus('Preencha seu nome.'); $('#client-name').focus(); return; }
    if (digits.length < 10 || digits.length > 15) { setStatus('Informe um telefone válido com DDD.'); $('#client-phone').focus(); return; }

    confirmButton.disabled = true;
    confirmButton.textContent = 'Confirmando…';
    let data, error;
    try {
      ({ data, error } = await supabase.rpc('create_public_booking', {
        p_slug: slug,
        p_service_id: service.service_id,
        p_data: dateInput.value,
        p_horario: `${selectedTime}:00`,
        p_nome: name,
        p_telefone: phone,
        p_observacoes: $('#client-notes').value.trim(),
      }));
    } catch {
      setStatus('Não foi possível realizar o agendamento. Confira sua conexão e tente novamente.');
      confirmButton.disabled = !selectedTime;
      confirmButton.innerHTML = 'Confirmar agendamento <span aria-hidden="true">→</span>';
      return;
    }
    confirmButton.innerHTML = 'Confirmar agendamento <span aria-hidden="true">→</span>';

    if (error) {
      if (['23P01', '23505'].includes(error.code)) {
        setStatus('Esse horário acabou de ser reservado por outra cliente. Escolha outro horário.');
        await loadAvailableSlots();
      } else if (error.code === '22023') {
        setStatus(error.message.includes('telefone') ? 'Informe um telefone válido com DDD.' : 'Confira os dados e tente novamente.');
      } else {
        setStatus('Não foi possível realizar o agendamento. Tente novamente.');
      }
      confirmButton.disabled = !selectedTime;
      return;
    }

    const saved = Array.isArray(data) ? data[0] : data;
    if (!saved) {
      setStatus('Não foi possível confirmar o agendamento. Tente novamente.');
      confirmButton.disabled = false;
      return;
    }
    renderConfirmation(saved);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  $('#copy-link').addEventListener('click', async () => {
    try {
      await copyText(window.location.href);
      $('#confirmation-status').textContent = 'Link da agenda copiado.';
      toast('Link da agenda copiado.');
    } catch {
      $('#confirmation-status').textContent = 'Não foi possível copiar o link neste navegador.';
    }
  });

  loadPage();
})();
