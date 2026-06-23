// Curated name + nickname pools for generating youth intake each season.
// Kept compact: ~30 first/last names per region and ~30 nicknames feels varied
// enough for decades of newgens without obvious recycling for the first few
// years. Nicknames are chosen to feel CS-native (short, distinctive).

import type { Region } from '../types';

export interface NewgenPool {
  first: string[];
  last: string[];
  nicks: string[];
  /** ISO-2 country codes typical for the region. Picked uniformly. */
  nationalities: string[];
}

export const NEWGEN_POOLS: Record<Region, NewgenPool> = {
  Europe: {
    first: [
      'Aaron', 'Adrian', 'Albin', 'Anders', 'Casper', 'Eli', 'Emil', 'Erik', 'Felix', 'Frederik',
      'Hugo', 'Jakob', 'Jonas', 'Karl', 'Kasper', 'Leon', 'Liam', 'Lukas', 'Marius', 'Mathias',
      'Max', 'Niko', 'Noah', 'Oliver', 'Oscar', 'Otto', 'Petar', 'Theo', 'Tobias', 'Viktor',
      'Vincent', 'William', 'Xavi', 'Zane',
    ],
    last: [
      'Andersen', 'Bauer', 'Becker', 'Berg', 'Christensen', 'Dahl', 'Engel', 'Fischer', 'Hahn',
      'Hansen', 'Holm', 'Jansen', 'Jensen', 'Johansson', 'Klein', 'Kowalski', 'Kruger', 'Larsen',
      'Lindstrom', 'Maier', 'Meyer', 'Moller', 'Nielsen', 'Novak', 'Olsen', 'Pedersen', 'Roth',
      'Schmidt', 'Strom', 'Werner', 'Sorensen', 'Bergstrom', 'Lindqvist', 'Eriksson',
    ],
    nicks: [
      'v0lk', 'jett', 'skylr', 'qrep', 'flxd', 'phyz', 'reckz', 'kyno', 'glith', 'zydan',
      'kvest', 'ny0', 'lokio', 'aerx', 'bzr', 'krit', 'tsai', 'm00n', 'enviy', 'wrekz',
      'tirex', 'jolt', 'rynx', 'klipz', 'shdw', 'vexa', 'plyte', 'orbz', 'kayz', 'nyte',
    ],
    nationalities: ['DK', 'SE', 'NO', 'FI', 'DE', 'FR', 'PL', 'CZ', 'NL', 'BE', 'PT', 'GB'],
  },
  CIS: {
    first: [
      'Aleksandr', 'Alexey', 'Andrey', 'Anton', 'Arseniy', 'Artyom', 'Bohdan', 'Daniil', 'Denis',
      'Dmitri', 'Egor', 'Evgeny', 'Fedor', 'Gleb', 'Igor', 'Ilya', 'Kirill', 'Maksim', 'Mark',
      'Matvey', 'Nikita', 'Oleg', 'Pavel', 'Roman', 'Ruslan', 'Sergey', 'Stas', 'Timur',
      'Valery', 'Vladislav', 'Yaroslav', 'Yuri',
    ],
    last: [
      'Antonov', 'Bondar', 'Chernov', 'Drozd', 'Egorov', 'Fedorov', 'Gritsenko', 'Ivanov',
      'Kovalenko', 'Kuznetsov', 'Lebedev', 'Lukin', 'Markov', 'Melnik', 'Mishchenko', 'Morozov',
      'Novak', 'Orlov', 'Pavlenko', 'Popov', 'Romanov', 'Savin', 'Sidorov', 'Sokolov',
      'Stepanov', 'Tarasov', 'Tkachenko', 'Vasiliev', 'Volkov', 'Zaitsev',
    ],
    nicks: [
      'g1ory', 'spirt', 'kr1k', 'sn1ff', 'r3dy', 'svn', 'kasp', 'mr1', 'zh1k', 'k1ng',
      'val0r', 'krym', 'dwnz', 'srgu', 'noxz', 'mvst', 'shr1', 'kez', 'akhr', 'zndr',
      'mxpz', 'snzy', 'xrnd', 'klr', 'icex', 'gpr', 'tplsh', 'fenra', 'tigr', 'phaz',
    ],
    nationalities: ['RU', 'UA', 'BY', 'KZ', 'LT', 'LV', 'EE'],
  },
  Americas: {
    first: [
      'Adrian', 'Andre', 'Bruno', 'Caio', 'Carlos', 'Diego', 'Eduardo', 'Emilio', 'Felipe',
      'Fernando', 'Gabriel', 'Gustavo', 'Hugo', 'Igor', 'Ivan', 'Jordan', 'Jose', 'Kyle',
      'Lucas', 'Luis', 'Marco', 'Mateo', 'Matheus', 'Miguel', 'Owen', 'Pedro', 'Rafael',
      'Ricardo', 'Tyler', 'Vitor',
    ],
    last: [
      'Alvarez', 'Anderson', 'Bautista', 'Brown', 'Carter', 'Castro', 'Costa', 'Davis', 'Diaz',
      'Fernandez', 'Garcia', 'Gomez', 'Hernandez', 'Johnson', 'Lopez', 'Martinez', 'Miller',
      'Moreno', 'Nguyen', 'Parker', 'Perez', 'Reyes', 'Rivera', 'Rodriguez', 'Sanchez',
      'Silva', 'Smith', 'Taylor', 'Torres', 'Vargas',
    ],
    nicks: [
      'huzn', 'soltz', 'kaiv', 'reyn', 'falxz', 'crv', 'mavi', 'jpz', 'truqz', 'fyrz',
      'velo', 'kobz', 'spry', 'krdo', 'jlvz', 'tnto', 'pzn', 'snavx', 'kru', 'vyno',
      'klr3', 'glsh', 'rovz', 'apxr', 'sym', 'xnvi', 'opxz', 'czr', 'tlpe', 'kerz',
    ],
    nationalities: ['US', 'CA', 'BR', 'AR', 'CL', 'MX', 'CO', 'PE', 'UY'],
  },
  Asia: {
    first: [
      'Akira', 'Bao', 'Bilguun', 'Chen', 'Cheng', 'Daichi', 'Dawei', 'Enkh', 'Faisal', 'Hao',
      'Haruki', 'Hiroto', 'Jian', 'Kai', 'Kenji', 'Kim', 'Long', 'Min', 'Naoki', 'Park',
      'Ren', 'Riku', 'Ryo', 'Sho', 'Sora', 'Tao', 'Tian', 'Wei', 'Yuto', 'Zhen',
    ],
    last: [
      'Bayar', 'Chen', 'Choi', 'Fukuda', 'Ganbat', 'Huang', 'Inoue', 'Kim', 'Kobayashi',
      'Lee', 'Li', 'Liang', 'Lim', 'Liu', 'Nakamura', 'Naranbat', 'Park', 'Sasaki', 'Sato',
      'Suzuki', 'Tanaka', 'Tian', 'Wang', 'Watanabe', 'Wu', 'Yamada', 'Yamamoto', 'Yang',
      'Zhang', 'Zhou',
    ],
    nicks: [
      'rynz', 'aki1', 'kybr', 'zhix', 'tigr1', 'xinz', 'kaolo', 'jryz', 'nyxa', 'sora1',
      'minox', 'taiz', 'mzln', 'kr3z', 'xnvy', 'shyn', 'yuto1', 'baoz', 'phyr', 'klr9',
      'spyz', 'gnz', 'kyto', 'vlmn', 'frzo', 'snzy1', 'velkz', 'kryt', 'tnz', 'opx1',
    ],
    nationalities: ['JP', 'KR', 'CN', 'MN', 'VN', 'TH', 'ID', 'PH', 'SG', 'MY'],
  },
};
