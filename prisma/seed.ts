import bcrypt from "bcrypt";
import { prisma } from "../src/prisma";
import { importMovieFromTmdb } from "../src/services/tmdb";

const USERS = [
  { name: "Admin WhatNext",  email: "admin.demo@whatsnext.app",   role: "superadmin" },
  { name: "Sofía Ramírez",   email: "sofia.demo@whatsnext.app",   role: "moderator" },
  { name: "Mateo Duarte",    email: "mateo.demo@whatsnext.app",   role: "user" },
  { name: "Lucía Fernández", email: "lucia.demo@whatsnext.app",   role: "user" },
  { name: "Nicolás Peralta", email: "nicolas.demo@whatsnext.app", role: "user" },
];

// Los mismos tmdbId que mockMovies (Top Gun, John Wick 4, Oppenheimer...)
const MOVIE_IDS = [361743, 603692, 872585, 278, 346698, 18785, 157336, 693134, 138843, 447332, 313369, 76341, 414906];
const FEATURED = [693134, 872585];       // destacadas en Populares (cámbienlas a gusto)

const TEMPLATES = [
  "La ambientación te mete de lleno, no pude pausarla ni un segundo.",
  "Buena, pero el final se sintió apurado.",
  "La banda sonora sola ya vale la pena verla.",
  "Actuaciones enormes. La volvería a ver en el cine.",
  "Arranca lento, pero la segunda mitad lo compensa.",
  "No me terminó de convencer, esperaba más.",
];

async function main() {
  // 1. Vaciar (de las tablas que dependen a las principales)
  await prisma.notification.deleteMany();
  await prisma.like.deleteMany();
  await prisma.repost.deleteMany();
  await prisma.review.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.redemption.deleteMany();
  await prisma.user.deleteMany();

  // 2. Usuarios (todos con la contraseña Demo1234)
  const passwordHash = await bcrypt.hash("Demo1234", 10);
  const users = [];
  for (const u of USERS) users.push(await prisma.user.create({ data: { ...u, passwordHash } }));
  const [admin, sofia, mateo, lucia] = users;

  // 3. Películas desde TMDB
  for (const id of MOVIE_IDS) {
    await importMovieFromTmdb(id);
    console.log(`Película ${id} importada`);
  }
  await prisma.movie.updateMany({ where: { id: { in: FEATURED } }, data: { featured: true } });

  // 4. Reseñas: la misma lógica que el bucle de mockData.ts
  let t = 0;
  const reviews = [];
  for (const [index, movieId] of MOVIE_IDS.entries()) {
    const count = 2 + ((index + 1) % 3);
    for (let i = 0; i < count; i++) {
      const author = users[(index + 1 + i) % users.length];
      reviews.push(await prisma.review.create({
        data: {
          text: TEMPLATES[t % TEMPLATES.length],
          rating: Math.round((2 + ((t * 37) % 4)) * 2) / 2,
          createdAt: new Date(Date.now() - t * 6 * 3600 * 1000),    // repartidas en los últimos días
          authorId: author.id,
          movieId,
        },
      }));
      t++;
    }
  }

  // 5. Likes: cada usuario likea algunas reseñas ajenas
  for (const [i, review] of reviews.entries()) {
    for (const user of users) {
      if (user.id !== review.authorId && (i + user.id) % 3 === 0) {
        await prisma.like.create({ data: { userId: user.id, reviewId: review.id } });
      }
    }
  }

  // 6. Amistades: Mateo y Lucía amigos; Sofía le pidió amistad al admin
  const pair = (a: number, b: number) => ({ userLowId: Math.min(a, b), userHighId: Math.max(a, b) });
  await prisma.friendship.create({
    data: { requesterId: mateo.id, addresseeId: lucia.id, ...pair(mateo.id, lucia.id), status: "accepted" },
  });
  const request = await prisma.friendship.create({
    data: { requesterId: sofia.id, addresseeId: admin.id, ...pair(sofia.id, admin.id) },
  });
  await prisma.notification.create({
    data: { type: "friend_request", recipientId: admin.id, actorId: sofia.id, friendshipId: request.id },
  });

  console.log(`Listo: ${users.length} usuarios, ${MOVIE_IDS.length} películas, ${reviews.length} reseñas`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());