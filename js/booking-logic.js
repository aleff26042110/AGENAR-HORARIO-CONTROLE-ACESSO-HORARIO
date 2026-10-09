/* Regras locais de disponibilidade usadas pelo painel autenticado da profissional. */
(function attachBookingLogic(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JosiBookingLogic = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createBookingLogic() {
  'use strict';

  function timeToMinutes(value) {
    const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function minutesToTime(value) {
    const minutes = Number(value);
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  function localDateISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function overlaps(startA, durationA, startB, durationB) {
    return startA < startB + durationB && startA + durationA > startB;
  }

  function availableSlots({ date, schedule, appointments = [], durationMin = 60, blocked = false, now = new Date() }) {
    if (blocked || !schedule || !schedule.ativo) return [];
    const opening = timeToMinutes(schedule.inicio);
    const closing = timeToMinutes(schedule.fim);
    const interval = Number(schedule.intervalo_min);
    const duration = Number(durationMin);
    if (opening === null || closing === null || closing <= opening || !Number.isInteger(interval) || interval < 1 || !Number.isFinite(duration) || duration < 1) return [];
    if (date < localDateISO(now)) return [];

    const breakStart = schedule.pausa_inicio ? timeToMinutes(schedule.pausa_inicio) : null;
    const breakEnd = schedule.pausa_fim ? timeToMinutes(schedule.pausa_fim) : null;
    const sameDay = date === localDateISO(now);
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const result = [];

    for (let start = opening; start + duration <= closing; start += interval) {
      if (sameDay && start <= currentMinute) continue;
      if (breakStart !== null && breakEnd !== null && overlaps(start, duration, breakStart, breakEnd - breakStart)) continue;

      const collides = appointments.some((appointment) => {
        if (appointment.data !== date) return false;
        const bookedStart = timeToMinutes(appointment.horario);
        const bookedDuration = Number(appointment.duracao_min || appointment.duracaoMin || 60);
        return bookedStart !== null && Number.isFinite(bookedDuration)
          && overlaps(start, duration, bookedStart, bookedDuration);
      });
      if (!collides) result.push(minutesToTime(start));
    }
    return result;
  }

  return { timeToMinutes, minutesToTime, overlaps, availableSlots };
});
