/* eslint-disable @typescript-eslint/no-explicit-any */
import { removeVersionFromAppId } from '@vtex/api'

import { currentSchema } from '../../utils'
import { getRole } from './Roles'
import { syncRoles } from '../Mutations/Roles'

const config: any = currentSchema('b2b_users')

export const getUser = async (_: any, params: any, ctx: Context) => {
  const {
    clients: { masterdata },
  } = ctx

  try {
    const { id } = params

    const cl: any = await masterdata.searchDocuments({
      dataEntity: 'CL',
      where: `userId=*${id}*`,
      fields: ['firstName', 'lastName', 'email'],
      pagination: { page: 1, pageSize: 1 },
    })

    if (!cl.length) {
      return null
    }

    const user: any = await masterdata.searchDocuments({
      dataEntity: config.name,
      fields: ['id', 'roleId', 'userId', 'canImpersonate'],
      schema: config.version,
      pagination: { page: 1, pageSize: 90 },
      where: `userId=${id}`,
    })

    return user.length
      ? {
          ...user[0],
          name: `${cl[0].firstName} ${cl[0].lastName}`,
          email: cl[0].email,
        }
      : []
  } catch (e) {
    return { status: 'error', message: e }
  }
}

export const getUserByRole = async (_: any, params: any, ctx: Context) => {
  const {
    clients: { masterdata },
  } = ctx

  const { id } = params

  try {
    return await masterdata.searchDocuments({
      dataEntity: config.name,
      fields: ['id', 'roleId', 'userId', 'name', 'email', 'canImpersonate'],
      schema: config.version,
      pagination: { page: 1, pageSize: 90 },
      where: `roleId=${id}`,
    })
  } catch (e) {
    return { status: 'error', message: e }
  }
}

export const getUserByEmail = async (_: any, params: any, ctx: Context) => {
  const {
    clients: { masterdata, vbase },
  } = ctx

  const { email } = params

  try {
    const cachedUser = await vbase.getJSON('b2b_users', email).catch(() => null)

    if (cachedUser) {
      return [cachedUser]
    }

    return await masterdata.searchDocuments({
      dataEntity: config.name,
      fields: ['id', 'roleId', 'userId', 'name', 'email', 'canImpersonate'],
      schema: config.version,
      pagination: { page: 1, pageSize: 50 },
      where: `email=${email}`,
    })
  } catch (e) {
    return { status: 'error', message: e }
  }
}

export const listUsers = async (_: any, __: any, ctx: Context) => {
  const {
    clients: { masterdata },
  } = ctx

  let res: any = []

  try {
    res = await masterdata.searchDocuments({
      dataEntity: config.name,
      fields: ['id', 'roleId', 'userId', 'name', 'email', 'canImpersonate'],
      schema: config.version,
      pagination: { page: 1, pageSize: 50 },
    })

    return res
  } catch (e) {
    return { status: 'error', message: e }
  }
}

export const checkUserPermission = async (_: any, __: any, ctx: Context) => {
  await syncRoles(ctx)

  const { sessionData, sender }: any = ctx.vtex

  if (!sessionData?.namespaces) {
    throw new Error('User not authenticated')
  }

  if (!sender) {
    throw new Error('Sender not available')
  }

  const module = removeVersionFromAppId(sender)
  const user = sessionData?.namespaces?.profile

  if (!user?.email?.value) {
    throw new Error('User session not available')
  }

  const userData: any = await getUserByEmail(
    _,
    { email: user.email.value },
    ctx
  )

  if (!userData.length) {
    throw new Error('User not found')
  }

  const userRole: any = await getRole(_, { id: userData[0].roleId }, ctx)

  if (!userRole) {
    throw new Error('Role not found')
  }

  const currentModule = userRole.features.find((feature: any) => {
    return feature.module === module
  })

  if (!currentModule) {
    throw new Error(`Role not found for module ${module}`)
  }

  return {
    role: userRole,
    permissions: currentModule.features,
  }
}
