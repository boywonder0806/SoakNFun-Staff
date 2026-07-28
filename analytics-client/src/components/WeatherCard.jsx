import { useEffect, useState } from 'react';
import api from '../lib/api.js';

// Tomorrow.io weather codes → label + icon (only codes that matter for a
// Louisiana/Mississippi waterpark summer; anything else falls back).
const CODES = {
  1000: ['Clear', '☀️'],
  1100: ['Mostly Clear', '🌤️'],
  1101: ['Partly Cloudy', '⛅'],
  1102: ['Mostly Cloudy', '🌥️'],
  1001: ['Cloudy', '☁️'],
  2000: ['Fog', '🌫️'],
  4000: ['Drizzle', '🌦️'],
  4200: ['Light Rain', '🌧️'],
  4001: ['Rain', '🌧️'],
  4201: ['Heavy Rain', '🌧️'],
  8000: ['Thunderstorm', '⛈️'],
};

export default function WeatherCard() {
  const [wx, setWx] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.get('/analytics/weather')
        .then(r => { if (!cancelled) { setWx(r.data); setFailed(false); } })
        .catch(() => { if (!cancelled) setFailed(true); });
    }
    load();
    const id = setInterval(load, 10 * 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (failed || !wx) return null;

  const [label, icon] = CODES[wx.weatherCode] || ['—', '🌡️'];

  return (
    <div className="card px-5 py-4 flex items-center gap-5 flex-wrap">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none">{icon}</span>
        <div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums leading-tight">{Math.round(wx.temperature)}°F</p>
          <p className="text-xs text-gray-500">{label} · feels like {Math.round(wx.feelsLike)}°</p>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 ml-auto">
        {wx.today && (
          <span>H {Math.round(wx.today.high)}° / L {Math.round(wx.today.low)}°</span>
        )}
        <span>💧 {Math.round(wx.today?.precipChance ?? wx.precipChance)}% rain</span>
        <span>UV {wx.uvIndex}</span>
        <span>💨 {Math.round(wx.windSpeed)} mph</span>
      </div>
    </div>
  );
}
