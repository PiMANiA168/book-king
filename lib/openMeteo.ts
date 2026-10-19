// WMO天気コードを日本語表記に変換するマップ
const weatherCodeMap: Record<number, string> = {
  0: '晴れ',
  1: 'ほぼ晴れ',
  2: '時々曇り',
  3: '曇り',
  45: '霧',
  48: '着氷性の霧',
  51: '軽い霧雨',
  53: '霧雨',
  55: '強い霧雨',
  61: '小雨',
  63: '雨',
  65: '激しい雨',
  71: '小雪',
  73: '雪',
  75: '激しい雪',
  80: 'にわか雨',
  81: '強いにわか雨',
  82: '激しいにわか雨',
  95: '雷雨',
};

export interface WeatherForecast {
  date: string;
  weather: string;
  tempMax: number;
  tempMin: number;
  pop: number; // 降水確率 (%)
}

export async function getWeeklyWeather(
  lat: number = 35.6895, // デフォルト: 東京 (例: 船橋の場合は 35.6947)
  lon: number = 139.6917 // デフォルト: 東京 (例: 船橋の場合は 139.9826)
): Promise<WeatherForecast[]> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo`;

    const res = await fetch(url, { next: { revalidate: 3600 } }); // 1時間キャッシュ
    if (!res.ok) return [];

    const data = await res.json();
    const daily = data.daily;

    if (!daily || !daily.time) return [];

    return daily.time.map((timeStr: string, index: number) => ({
      date: timeStr,
      weather: weatherCodeMap[daily.weathercode[index]] || '不明',
      tempMax: Math.round(daily.temperature_2m_max[index]),
      tempMin: Math.round(daily.temperature_2m_min[index]),
      pop: daily.precipitation_probability_max[index] ?? 0,
    }));
  } catch (error) {
    console.error('Open-Meteo Error:', error);
    return [];
  }
}