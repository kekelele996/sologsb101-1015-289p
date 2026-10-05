<script setup lang="ts">
/**
 * /supports 支撑加固与避雷件登记
 * 超周期未检查的加固件自动高亮并生成检查提醒；冬季 / 汛期无法上树时可登记缓检（缓检日 + 理由），
 * 生效到期日取原到期日与缓检日的较晚者；支持一键登记本次检查（自动清除缓检、按周期重新起算）。
 * 消费模型：Support、Tree；复用组件：<StatBadge>、<EmptyPanel>、<FilterBar>、<VigorTag>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import FilterBar from '@/components/common/FilterBar.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import VigorTag from '@/components/common/VigorTag.vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useTreeStore } from '@/stores/treeStore'
import { clearSupportPostpone, db, markSupportChecked, postponeSupport } from '@/utils/db'
import { SUPPORT_TYPE_OPTIONS, type Support, type SupportDraft, type SupportType } from '@/types/support'
import { isPostponeEffective, isSupportOverdue, nextCheckDate, overdueDays, supportDueDate } from '@/utils/dimension'
import { today } from '@/utils/id'

const treeStore = useTreeStore()

const { rows, loading, create, update, remove } = useIdbTable<Support>(db.supports, { sortByUpdatedAt: false })

const keyword = ref('')
const treeFilter = ref('all')
const typeFilter = ref<SupportType | 'all'>('all')
const overdueOnly = ref(false)
const postponedOnly = ref(false)

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const postponeDialogVisible = ref(false)
const postponeSubmitting = ref(false)
const postponingId = ref<string | null>(null)
const postponeFormRef = ref<FormInstance>()

const postponeForm = reactive<{ postponeDate: string; postponeReason: string }>({
  postponeDate: today(),
  postponeReason: '',
})

const postponeRules: FormRules<{ postponeDate: string; postponeReason: string }> = {
  postponeDate: [{ required: true, message: '请选择缓检日', trigger: 'change' }],
  postponeReason: [
    { required: true, message: '请填写缓检理由（如冬季封冻 / 汛期无法上树）', trigger: 'blur' },
    { max: 100, message: '缓检理由不超过 100 个字符', trigger: 'blur' },
  ],
}

const form = reactive<SupportDraft>({
  treeId: '',
  type: '支撑杆',
  installDate: '',
  checkCycleMon: 12,
  lastCheckDate: '',
})

const rules: FormRules<SupportDraft> = {
  treeId: [{ required: true, message: '请选择古树', trigger: 'change' }],
  type: [{ required: true, message: '请选择加固件类型', trigger: 'change' }],
  installDate: [{ required: true, message: '请选择安装日期', trigger: 'change' }],
  checkCycleMon: [{ required: true, message: '请填写检查周期', trigger: 'blur' }],
}

const treeLabel = computed<Record<string, string>>(() =>
  Object.fromEntries(treeStore.trees.map((tree) => [tree.id, `${tree.code} ${tree.species}`]))
)

const filtered = computed<Support[]>(() => {
  const key = keyword.value.trim().toLowerCase()
  return rows.value
    .filter((row) => {
      if (treeFilter.value !== 'all' && row.treeId !== treeFilter.value) return false
      if (typeFilter.value !== 'all' && row.type !== typeFilter.value) return false
      if (overdueOnly.value && !isSupportOverdue(row)) return false
      if (postponedOnly.value && row.postponeDate === '') return false
      if (key === '') return true
      return (
        (treeLabel.value[row.treeId] ?? '').toLowerCase().includes(key) ||
        row.type.toLowerCase().includes(key) ||
        row.lastCheckDate.includes(key) ||
        row.postponeDate.includes(key) ||
        row.postponeReason.toLowerCase().includes(key)
      )
    })
    .sort((a, b) => a.installDate.localeCompare(b.installDate))
})

const overdueRows = computed<Support[]>(() => rows.value.filter((row) => isSupportOverdue(row)))

/** 已登记缓检且缓检生效（未超期）的加固件 */
const postponedRows = computed<Support[]>(() =>
  rows.value.filter((row) => row.postponeDate !== '' && !isSupportOverdue(row))
)

const coveredTrees = computed<number>(() => new Set(rows.value.map((row) => row.treeId)).size)

onMounted(() => {
  void treeStore.loadAll()
})

function rowClassName({ row }: { row: Support }): string {
  if (isSupportOverdue(row)) return 'row-overdue'
  if (row.postponeDate !== '') return 'row-postponed'
  return ''
}

function openCreate(): void {
  const treeId =
    treeFilter.value !== 'all' ? treeFilter.value : (treeStore.currentTreeId ?? treeStore.trees[0]?.id ?? '')
  editingId.value = null
  Object.assign(form, {
    treeId,
    type: '支撑杆' as SupportType,
    installDate: today(),
    checkCycleMon: 12,
    lastCheckDate: today(),
  })
  dialogVisible.value = true
}

function openEdit(row: Support): void {
  editingId.value = row.id
  Object.assign(form, {
    treeId: row.treeId,
    type: row.type,
    installDate: row.installDate,
    checkCycleMon: row.checkCycleMon,
    lastCheckDate: row.lastCheckDate,
  })
  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (formRef.value === undefined) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value === null) {
      await create({ ...form, postponeDate: '', postponeReason: '' }, 'support')
      ElMessage.success('加固件已登记')
    } else {
      await update(editingId.value, { ...form })
      ElMessage.success('加固件已更新')
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Support): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.type}」加固件记录？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  await remove(row.id)
  ElMessage.success('加固件记录已删除')
}

async function handleMarkChecked(row: Support): Promise<void> {
  await markSupportChecked(row.id, today())
  ElMessage.success(`已登记 ${treeLabel.value[row.treeId] ?? '该古树'} 的 ${row.type} 本次检查，缓检已清除并按周期重新起算`)
}

/** 打开缓检弹窗：已缓检的件回显缓检日与理由，可直接修改 */
function openPostpone(row: Support): void {
  postponingId.value = row.id
  Object.assign(postponeForm, {
    postponeDate: row.postponeDate !== '' ? row.postponeDate : today(),
    postponeReason: row.postponeReason,
  })
  postponeDialogVisible.value = true
}

const postponingRow = computed<Support | null>(
  () => rows.value.find((row) => row.id === postponingId.value) ?? null
)

/** 缓检弹窗内的原到期日 */
const postponeOriginalDue = computed<string>(() =>
  postponingRow.value === null
    ? ''
    : nextCheckDate(postponingRow.value.lastCheckDate, postponingRow.value.checkCycleMon)
)

/** 按当前填写的缓检日算出的生效到期日 */
const postponeEffectiveDue = computed<string>(() =>
  postponingRow.value === null
    ? ''
    : supportDueDate({
        lastCheckDate: postponingRow.value.lastCheckDate,
        checkCycleMon: postponingRow.value.checkCycleMon,
        postponeDate: postponeForm.postponeDate,
      })
)

async function handlePostponeSubmit(): Promise<void> {
  if (postponeFormRef.value === undefined) return
  const valid = await postponeFormRef.value.validate().catch(() => false)
  if (!valid) return
  if (postponingId.value === null) return
  postponeSubmitting.value = true
  try {
    await postponeSupport(postponingId.value, postponeForm.postponeDate, postponeForm.postponeReason.trim())
    ElMessage.success('缓检已登记')
    postponeDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    postponeSubmitting.value = false
  }
}

async function handleClearPostpone(): Promise<void> {
  if (postponingId.value === null) return
  try {
    await ElMessageBox.confirm('取消后该加固件恢复按原检查周期计算到期日，确认取消缓检？', '取消缓检', {
      type: 'warning',
      confirmButtonText: '取消缓检',
      cancelButtonText: '返回',
    })
  } catch {
    return
  }
  await clearSupportPostpone(postponingId.value)
  ElMessage.success('已取消缓检')
  postponeDialogVisible.value = false
}

function handleFilterChange(key: string, value: string): void {
  if (key === 'treeId') treeFilter.value = value
  if (key === 'type') typeFilter.value = value as SupportType | 'all'
}
</script>

<template>
  <div>
    <div class="stat-row">
      <StatBadge label="加固件总数" :value="rows.length" suffix="件" tone="primary" icon="Histogram" />
      <StatBadge
        label="超期未检查"
        :value="overdueRows.length"
        suffix="件"
        :tone="overdueRows.length > 0 ? 'danger' : 'success'"
        icon="Warning"
        hint="生效到期日（含缓检顺延后）早于今天的加固件"
      />
      <StatBadge
        label="缓检中"
        :value="postponedRows.length"
        suffix="件"
        :tone="postponedRows.length > 0 ? 'warning' : 'success'"
        icon="Timer"
        hint="冬季 / 汛期无法上树，已申请缓检且当前仍在缓检周期内的加固件"
      />
      <StatBadge label="覆盖古树" :value="coveredTrees" suffix="株" tone="info" icon="DataLine" />
      <StatBadge label="筛选结果" :value="filtered.length" suffix="件" tone="default" icon="PieChart" size="small" />
    </div>

    <el-alert
      v-if="overdueRows.length > 0"
      type="warning"
      show-icon
      :closable="false"
      class="mb-14"
      :title="`有 ${overdueRows.length} 件加固件超过检查周期未检查`"
    >
      <template #default>
        <div class="overdue-list">
          <div v-for="row in overdueRows" :key="row.id">
            {{ treeLabel[row.treeId] ?? '（古树已删除）' }} · {{ row.type }}：最近检查
            {{ row.lastCheckDate || '未记录' }}，检查周期 {{ row.checkCycleMon }} 个月，
            <template v-if="row.postponeDate !== ''">
              已缓检至 {{ supportDueDate(row) }}，缓检仍超期
            </template>
            已超期 {{ overdueDays(row) }} 天
          </div>
        </div>
      </template>
    </el-alert>

    <el-alert
      v-if="postponedRows.length > 0"
      type="info"
      show-icon
      :closable="false"
      class="mb-14"
      :title="`有 ${postponedRows.length} 件加固件已申请缓检，当前仍在缓检周期内`"
    >
      <template #default>
        <div class="overdue-list">
          <div v-for="row in postponedRows" :key="row.id">
            {{ treeLabel[row.treeId] ?? '（古树已删除）' }} · {{ row.type }}：缓检至
            {{ supportDueDate(row) }}（理由：{{ row.postponeReason || '未填理由' }}），到期前完成检查即可
          </div>
        </div>
      </template>
    </el-alert>

    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span class="card-header__title">支撑加固与避雷件登记</span>
          <el-button type="primary" @click="openCreate" :disabled="treeStore.trees.length === 0">
            <el-icon><Plus /></el-icon>
            <span>登记加固件</span>
          </el-button>
        </div>
      </template>

      <FilterBar
        :keyword="keyword"
        :fields="[
          {
            key: 'treeId',
            label: '古树',
            options: treeStore.trees.map((tree) => tree.id),
            optionLabels: treeLabel,
          },
          { key: 'type', label: '类型', options: SUPPORT_TYPE_OPTIONS as unknown as string[] },
        ]"
        :values="{ treeId: treeFilter, type: typeFilter }"
        :result-text="`命中 ${filtered.length} / ${rows.length} 件`"
        @update:keyword="(value: string) => (keyword = value)"
        @change="handleFilterChange"
        @reset="
          () => {
            keyword = ''
            treeFilter = 'all'
            typeFilter = 'all'
            overdueOnly = false
            postponedOnly = false
          }
        "
      >
        <template #extra>
          <el-checkbox v-model="overdueOnly" border size="small">只看超期未检查</el-checkbox>
          <el-checkbox v-model="postponedOnly" border size="small">只看缓检中</el-checkbox>
        </template>
      </FilterBar>

      <EmptyPanel
        v-if="rows.length === 0 && !loading"
        title="还没有加固件记录"
        description="登记支撑杆、拉纤与避雷件，设置检查周期后系统会自动高亮超期未检查的设施并生成提醒；冬季 / 汛期无法上树时可申请缓检。"
        action-text="登记第一件加固件"
        @action="openCreate"
      />

      <el-table
        v-else
        v-loading="loading || !treeStore.ready"
        :data="filtered"
        row-key="id"
        stripe
        :row-class-name="rowClassName"
      >
        <el-table-column label="古树" min-width="190">
          <template #default="{ row }">
            <div class="cell-stack">
              <span>{{ treeLabel[row.treeId] ?? '（古树已删除）' }}</span>
              <VigorTag
                :vigor="treeStore.statOf(row.treeId).latestVigor"
                :trend="treeStore.statOf(row.treeId).latestTrend"
                size="small"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.type === '避雷' ? 'warning' : row.type === '拉纤' ? 'info' : 'success'">
              {{ row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="installDate" label="安装日期" width="120" />
        <el-table-column label="检查周期" width="110" align="right">
          <template #default="{ row }">{{ row.checkCycleMon }} 个月</template>
        </el-table-column>
        <el-table-column label="最近检查" width="130">
          <template #default="{ row }">
            <span v-if="row.lastCheckDate === ''" class="cell-warn">未记录</span>
            <span v-else>{{ row.lastCheckDate }}</span>
          </template>
        </el-table-column>
        <el-table-column label="下次检查" width="150">
          <template #default="{ row }">
            <el-tooltip
              v-if="row.postponeDate !== ''"
              placement="top"
              :content="`原到期日 ${nextCheckDate(row.lastCheckDate, row.checkCycleMon) || '—'}；缓检理由：${row.postponeReason || '未填理由'}`"
            >
              <span>
                {{ supportDueDate(row) || '—' }}
                <el-icon class="due-postpone-icon"><Timer /></el-icon>
              </span>
            </el-tooltip>
            <span v-else>{{ nextCheckDate(row.lastCheckDate, row.checkCycleMon) || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="缓检" min-width="170">
          <template #default="{ row }">
            <div v-if="row.postponeDate !== ''" class="cell-stack">
              <el-tag :type="isPostponeEffective(row) ? 'warning' : 'info'" size="small" effect="plain">
                缓检至 {{ row.postponeDate }}
              </el-tag>
              <span class="cell-sub">{{ row.postponeReason || '未填理由' }}</span>
              <span v-if="!isPostponeEffective(row)" class="cell-sub">
                早于原到期日，仍按 {{ nextCheckDate(row.lastCheckDate, row.checkCycleMon) }} 算
              </span>
            </div>
            <span v-else class="cell-sub">—</span>
          </template>
        </el-table-column>
        <el-table-column label="检查状态" width="170">
          <template #default="{ row }">
            <el-tag v-if="isSupportOverdue(row)" type="danger" effect="dark">
              超期 {{ overdueDays(row) }} 天
            </el-tag>
            <el-tag v-else-if="row.postponeDate !== ''" type="warning" effect="light">缓检周期内</el-tag>
            <el-tag v-else type="success" effect="light">周期内</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <el-button
              link
              :type="isSupportOverdue(row) ? 'danger' : 'primary'"
              size="small"
              @click="handleMarkChecked(row)"
            >
              登记本次检查
            </el-button>
            <el-button link type="warning" size="small" @click="openPostpone(row)">
              {{ row.postponeDate === '' ? '申请缓检' : '修改缓检' }}
            </el-button>
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '登记加固件' : '编辑加固件'" width="600px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="古树" prop="treeId">
          <el-select v-model="form.treeId" filterable style="width: 100%">
            <el-option
              v-for="tree in treeStore.trees"
              :key="tree.id"
              :value="tree.id"
              :label="`${tree.code} · ${tree.species} · ${tree.location}`"
            />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="类型" prop="type">
              <el-select v-model="form.type" style="width: 100%">
                <el-option v-for="item in SUPPORT_TYPE_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="安装日期" prop="installDate">
              <el-date-picker v-model="form.installDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="检查周期（月）" prop="checkCycleMon">
              <el-input-number v-model="form.checkCycleMon" :min="1" :max="120" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最近检查日期">
              <el-date-picker v-model="form.lastCheckDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          type="info"
          show-icon
          :closable="false"
          :title="`下次检查日期：${nextCheckDate(form.lastCheckDate, form.checkCycleMon) || '请先填写最近检查日期'}`"
          description="超过下次检查日期仍未登记检查的加固件，会在列表中自动高亮并出现在顶部提醒中。"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="postponeDialogVisible"
      :title="postponingRow !== null && postponingRow.postponeDate !== '' ? '修改缓检' : '申请缓检'"
      width="520px"
    >
      <el-form
        v-if="postponingRow !== null"
        ref="postponeFormRef"
        :model="postponeForm"
        :rules="postponeRules"
        label-width="100px"
      >
        <el-alert
          type="info"
          show-icon
          :closable="false"
          class="mb-14"
          :title="`${treeLabel[postponingRow.treeId] ?? '该古树'} · ${postponingRow.type}：原到期日 ${postponeOriginalDue || '—'}`"
          description="冬季封冻、汛期等无法上树时可申请缓检；缓检只能往后推，缓检日早于原到期日的仍按原到期日算。"
        />
        <el-form-item label="缓检日" prop="postponeDate">
          <el-date-picker v-model="postponeForm.postponeDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </el-form-item>
        <el-form-item label="缓检理由" prop="postponeReason">
          <el-input
            v-model="postponeForm.postponeReason"
            type="textarea"
            :rows="2"
            maxlength="100"
            show-word-limit
            placeholder="如：冬季封冻无法登高攀爬，申请缓检至汛期结束后"
          />
        </el-form-item>
        <el-alert
          :type="postponeForm.postponeDate !== '' && postponeEffectiveDue !== postponeOriginalDue ? 'warning' : 'success'"
          show-icon
          :closable="false"
          :title="
            postponeEffectiveDue !== postponeOriginalDue
              ? `保存后下次检查日期顺延为 ${postponeEffectiveDue}；缓检日当天仍算周期内`
              : `缓检日未晚于原到期日，下次检查日期仍为 ${postponeOriginalDue || '—'}`
          "
        />
      </el-form>
      <template #footer>
        <el-button
          v-if="postponingRow !== null && postponingRow.postponeDate !== ''"
          type="danger"
          plain
          @click="handleClearPostpone"
        >
          取消缓检
        </el-button>
        <el-button @click="postponeDialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="postponeSubmitting" @click="handlePostponeSubmit">保存缓检</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.card-header__title {
  font-size: 15px;
  font-weight: 600;
  color: #2f2a24;
}

.overdue-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 1.8;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cell-warn {
  color: #c0392b;
  font-weight: 600;
}

.cell-sub {
  font-size: 12px;
  color: #8c8479;
}

.due-postpone-icon {
  vertical-align: -2px;
  color: #d68910;
  font-size: 13px;
}

.mb-14 {
  margin-bottom: 14px;
}

:deep(.row-overdue) {
  --el-table-tr-bg-color: #fdf3f2;
}

:deep(.row-postponed) {
  --el-table-tr-bg-color: #fdf8ec;
}
</style>
