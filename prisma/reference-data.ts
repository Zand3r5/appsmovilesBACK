export const rewards = [
  {
    "id": "popcorn",
    "title": "Pochoclos medianos",
    "description": "En cines adheridos",
    "icon": "fast-food-outline",
    "cost": 30
  },
  {
    "id": "two_for_one",
    "title": "2x1 en entradas",
    "description": "Válido de lunes a jueves",
    "icon": "ticket-outline",
    "cost": 60
  },
  {
    "id": "presale",
    "title": "Preventa anticipada",
    "description": "Acceso 24 h antes a preventas",
    "icon": "time-outline",
    "cost": 100
  },
  {
    "id": "free_ticket",
    "title": "Entrada gratis",
    "description": "Una función 2D a elección",
    "icon": "film-outline",
    "cost": 150
  }
];
export const achievements = [
  {
    "id": "first_review",
    "title": "Primera reseña",
    "description": "Publicá tu primera reseña",
    "icon": "create-outline",
    "stat": "totalReviews",
    "goal": 1,
    "points": 10
  },
  {
    "id": "active_critic",
    "title": "Crítico en marcha",
    "description": "Publicá 5 reseñas",
    "icon": "chatbubbles-outline",
    "stat": "totalReviews",
    "goal": 5,
    "points": 20
  },
  {
    "id": "expert_critic",
    "title": "Crítico experto",
    "description": "Publicá 15 reseñas",
    "icon": "ribbon-outline",
    "stat": "totalReviews",
    "goal": 15,
    "points": 30
  },
  {
    "id": "viral_review",
    "title": "Reseña viral",
    "description": "Conseguí 100 likes o más en una sola reseña",
    "icon": "flame-outline",
    "stat": "maxLikesOnReview",
    "goal": 100,
    "points": 50
  },
  {
    "id": "genre_explorer",
    "title": "Explorador de géneros",
    "description": "Reseñá películas de 3 géneros distintos",
    "icon": "compass-outline",
    "stat": "distinctGenres",
    "goal": 3,
    "points": 10
  },
  {
    "id": "star_rater",
    "title": "Todo estrellas",
    "description": "Calificá con estrellas 5 películas",
    "icon": "star-outline",
    "stat": "totalRatings",
    "goal": 5,
    "points": 15
  },
  {
    "id": "cinema_photo",
    "title": "Fui al cine",
    "description": "Subí una reseña con foto",
    "icon": "camera-outline",
    "stat": "totalPhotos",
    "goal": 1,
    "points": 20
  }
];
export const ranks = [
  {
    "min": 5,
    "name": "Espectador",
    "icon": "eye"
  },
  {
    "min": 25,
    "name": "Cinéfilo",
    "icon": "film"
  },
  {
    "min": 50,
    "name": "Crítico",
    "icon": "chatbubble-ellipses"
  },
  {
    "min": 100,
    "name": "Director",
    "icon": "videocam"
  }
];