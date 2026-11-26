import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Calendar as CalendarIcon, Clock, Phone, User, CheckCircle } from 'lucide-react';

interface Booking {
  id: string;
  clientName: string;
  clientPhone: string;
  date: string;
  service: string;
  status: string;
}

export function CalendarTab({ wsSocket }: { wsSocket: WebSocket | null }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  // Generate current week dates
  const today = new Date();
  const startDate = startOfWeek(today, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(startDate, i));

  // Time slots from 08:00 to 22:00
  const timeSlots = Array.from({ length: 15 }).map((_, i) => i + 8);

  useEffect(() => {
    fetchBookings();
  }, []);

  useEffect(() => {
    if (!wsSocket) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'booking_created') {
          setBookings(prev => [...prev, data.booking]);
        }
      } catch (e) {}
    };

    wsSocket.addEventListener('message', handleMessage);
    return () => wsSocket.removeEventListener('message', handleMessage);
  }, [wsSocket]);

  const fetchBookings = async () => {
    try {
      const response = await fetch('http://localhost:3001/api/companies/me/bookings', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      const data = await response.json();
      if (data.success) {
        setBookings(data.bookings);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getBookingForSlot = (day: Date, hour: number) => {
    return bookings.find(b => {
      const d = new Date(b.date);
      // Используем локальное время браузера (UTC+5), а не UTC
      const localHour = d.getHours(); // getHours() уже возвращает локальное время
      return isSameDay(d, day) && localHour === hour;
    });
  };

  if (loading) return <div>Загрузка календаря...</div>;

  return (
    <div className="animate-fade-in" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <CalendarIcon /> Календарь записей
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Управление записями клиентов. Интеграция обновляется в реальном времени.
          </p>
        </div>
      </div>

      <div className="glass-panel" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '80px repeat(7, 1fr)', 
          gap: 12,
          minWidth: 900
        }}>
          {/* Header Row */}
          <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}></div>
          {weekDays.map((day, i) => (
            <div key={i} style={{ 
              textAlign: 'center', 
              paddingBottom: 16,
              borderBottom: '1px solid var(--border-color)',
              color: isSameDay(day, today) ? 'var(--primary-color)' : 'var(--text-secondary)',
              fontWeight: isSameDay(day, today) ? 700 : 500
            }}>
              <div style={{ fontSize: 13, textTransform: 'capitalize' }}>
                {format(day, 'EEEE', { locale: ru })}
              </div>
              <div style={{ fontSize: 24, marginTop: 4 }}>
                {format(day, 'd')}
              </div>
            </div>
          ))}

          {/* Time Slots */}
          {timeSlots.map(hour => (
            <React.Fragment key={hour}>
              {/* Hour Label */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'flex-start', 
                justifyContent: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                paddingTop: 16
              }}>
                {hour}:00
              </div>

              {/* Day Cells */}
              {weekDays.map((day, i) => {
                const booking = getBookingForSlot(day, hour);
                return (
                  <div key={`${i}-${hour}`} style={{ 
                    height: 100, 
                    border: '1px dashed rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    padding: 8,
                    position: 'relative',
                    transition: 'all 0.2s',
                    background: booking ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                    borderColor: booking ? 'var(--success)' : 'rgba(255,255,255,0.1)'
                  }}>
                    {booking && (
                      <div className="animate-fade-in" style={{
                        width: '100%', height: '100%',
                        display: 'flex', flexDirection: 'column', gap: 4
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={12} /> {booking.service}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <User size={12} /> {booking.clientName}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Phone size={12} /> {booking.clientPhone}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
