const { QueryTypes } = require('sequelize')
const { Restaurant, Category, Comment, User, sequelize } = require('../models')
const { getOffset, getPagination } = require('../helpers/pagination-helper')

const restaurantController = {
  getRestaurants: (req, res, next) => {
    const DEFAULT_LIMIT = 9
    const categoryId = Number(req.query.categoryId) || ''
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || DEFAULT_LIMIT
    const offset = getOffset(limit, page)

    return Promise.all([
      Restaurant.findAndCountAll({
        include: Category,
        where: {
          ...categoryId ? { categoryId } : {}
        },
        limit,
        offset,
        nest: true,
        raw: true
      }),
      Category.findAll({ raw: true })
    ])
      .then(([restaurants, categories]) => {
        const favoritedRestaurantsId = req.user && req.user.FavoritedRestaurants.map(fr => fr.id)
        const likedRestaurantsId = req.user && req.user.LikedRestaurants.map(fr => fr.id)
        const data = restaurants.rows.map(r => ({
          ...r,
          description: r.description.substring(0, 50),
          isFavorited: favoritedRestaurantsId.includes(r.id),
          isLiked: likedRestaurantsId.includes(r.id)
        }))
        return res.render('restaurants', {
          restaurants: data,
          categories,
          categoryId,
          pagination: getPagination(limit, page, restaurants.count)
        })
      })
      .catch(err => next(err))
  },
  getRestaurant: (req, res, next) => {
    return Restaurant.findByPk(req.params.id, {
      include: [Category,
        { model: Comment, include: User },
        { model: User, as: 'FavoritedUsers' },
        { model: User, as: 'LikedUsers' }
      ],
      order: [
        [Comment, 'createdAt', 'DESC']
      ]
    })
      .then(restaurant => {
        if (!restaurant) throw new Error("Restaurant didn't exist!")
        return restaurant.increment('viewCounts', { by: 1 })
      })
      .then(restaurant => {
        const isFavorited = restaurant.FavoritedUsers.some(f => f.id === req.user.id)
        const isLiked = restaurant.LikedUsers.some(f => f.id === req.user.id)
        return res.render('restaurant', { restaurant: restaurant.toJSON(), isFavorited, isLiked })
      })
      .catch(err => next(err))
  },
  getDashboard: (req, res, next) => {
    return Restaurant.findByPk(req.params.id, {
      include: [Category, Comment]
    })
      .then(restaurant => {
        if (!restaurant) throw new Error("Restaurant didn't exist!")
        return res.render('dashboard', { restaurant: restaurant.toJSON() })
      })
      .catch(next)
  },
  getFeeds: (req, res, next) => {
    return Promise.all([
      Restaurant.findAll({
        limit: 10,
        order: [['createdAt', 'DESC']],
        include: [Category],
        raw: true,
        nest: true
      }),
      Comment.findAll({
        limit: 10,
        order: [['createdAt', 'DESC']],
        include: [User, Restaurant],
        raw: true,
        nest: true
      })
    ])
      .then(([restaurants, comments]) => {
        res.render('feeds', {
          restaurants,
          comments
        })
      })
      .catch(err => next(err))
  },
  getTopRestaurants: async (req, res, next) => {
    try {
      const resultRestaurants = []
      const topRestaurants = await sequelize.query(
        `SELECT Restaurants.* , COUNT(user_id) AS FavoritedUsers
        FROM Restaurants
        JOIN Favorites
        ON Restaurants.id = Favorites.restaurant_id
        GROUP BY restaurant_id
        ORDER BY FavoritedUsers DESC
        LIMIT 10`,
        { type: QueryTypes.SELECT }
      )
      // 整理撈出來的資料
      topRestaurants.forEach(r => {
        r.description = r.description.substring(0, 50)
        r.favoritedCount = r.FavoritedUsers
        r.isFavorited = req.user && req.user.FavoritedRestaurants.some(f => f.id === r.id)
      })
      resultRestaurants.push(...topRestaurants)
      // 如果被收藏的餐廳不滿10間，就隨機撈其他餐廳湊滿10間
      if (topRestaurants.length < 10) {
        const randomRestaurants = await Restaurant.findAll({
          order: sequelize.literal('rand()'),
          limit: 10 - topRestaurants.length,
          raw: true
        })
        // 整理隨機餐廳的資料
        randomRestaurants.forEach(r => {
          r.description = r.description.substring(0, 50)
          r.favoritedCount = r.FavoritedUsers || 0
          r.isFavorited = req.user && req.user.FavoritedRestaurants.some(f => f.id === r.id)
        })
        resultRestaurants.push(...randomRestaurants)
      }
      res.render('top-restaurants', { restaurants: resultRestaurants })
    } catch (err) {
      next(err)
    }
  }
}

module.exports = restaurantController
