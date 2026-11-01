# Поездки — как устроено

Экран `/travel` и чат зовут один слой.

- Планы и брони: `src/lib/db/travel.ts` → таблицы `trip_plans` и `travel_bookings`.
- Поиск: `src/lib/features/travel/search.ts`. Экран ходит в `POST /api/travel/search`, чат — в тулы `search_flights`, `search_hotels`, `search_tours`.
- Без ключа билеты и отели не выдумывают цену: возвращается ссылка на Aviasales или Booking.com.
- С ключом Aviasales отдаёт кэш цен, Amadeus — предложения отелей, Турвизор — пакетные туры. Поиск не создаёт заказ.
- Расписание поездки лежит в `trip_plans.plan_data.events`: дата, время, длительность в минутах, место, тип `flight | hotel | activity | transport`. Экран `/travel` показывает месяц с отметками и список выбранного дня. Чат пишет те же пункты через `add_trip_event`, `update_trip_event`, `delete_trip_event`. Заметка плана (`notes`) при правке не затирает события.
- Запись плана и брони в чате только после «да». `status=booked` значит «человек сказал, что купил». `cancelled` снимает запись у нас и не отменяет бронь у перевозчика.
