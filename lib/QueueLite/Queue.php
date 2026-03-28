<?php

namespace QueueLite;

use \MongoHybrid\Client as MongoHybridClient;


class Queue {

    protected MongoHybridClient $storage;
    protected string $queueName;
    protected array $options;

    protected int $lockTimeout = 300;
    protected string $collectionName = 'queuelite/queue';

    protected string $reservationTokenKey = '__reservation_token';

    public function __construct(MongoHybridClient $storage, string $queueName, array $options = []) {

        $this->storage = $storage;
        $this->queueName = $queueName;
        $this->options = $options;

        if (isset($options['lockTimeout'])) {
            $this->lockTimeout = $options['lockTimeout'];
        }

        if (isset($options['collectionName'])) {
            $this->collectionName = $options['collectionName'];
        }
    }

    public function push(array $data, array $options = []): array {

        $options = \array_merge([
            'delay' => 0,
            'priority' => 0,
            'maxAttempts' => 1,
            'uid' => null,
            'repeat' => null,
        ], $options);

        extract($options);

        if ($uid) {

            $this->storage->remove($this->collectionName, [
                'queue' => $this->queueName,
                'status' => 'pending',
                'uid' => $uid,
            ]);
        }

        $timestamp = \time();
        $availableAt = $timestamp + $delay;

        if (isset($options['repeat'])) {

            if (\is_string($repeat)) {
                $repeat = [
                    'interval' => $repeat,
                    'count' => null,
                    'until' => null
                ];
            }

            if (\is_array($repeat)) {

                $repeat = \array_merge([
                    'count' => null,
                    'interval' => null,
                    'until' => null
                ], $repeat);

                if (\is_string($repeat['until'])) {
                    $repeat['until'] = \strtotime($repeat['until'], $availableAt);
                }

                if (isset($repeat['interval'])) {
                    $availableAt = $this->calculateNextRepeatableInterval($repeat['interval'], $timestamp);
                }

            } else {
                unset($options['repeat']);
            }
        }


        $message = [
            'queue' => $this->queueName,
            'data' => $data,
            'available_at' => $availableAt,
            'created_at' => $timestamp,
            'priority' => $priority,
            'status' => 'pending',
            'attempts' => 0,
            'max_attempts' => \abs($maxAttempts),
            'uid' => $uid,
        ];

        if (isset($options['repeat'])) {
            $message['repeat'] = $repeat;
        }

        $this->storage->save($this->collectionName, $message);

        return $message;
    }

    protected function createReservationToken(): string {

        try {
            return \bin2hex(\random_bytes(16));
        } catch (\Throwable) {
            return \uniqid('ql.', true);
        }
    }

    protected function updateMatchedAny(mixed $result): bool {

        if (\is_int($result)) {
            return $result > 0;
        }

        if (\is_object($result)) {

            if (\method_exists($result, 'getMatchedCount')) {
                return $result->getMatchedCount() > 0;
            }

            if (\method_exists($result, 'getModifiedCount')) {
                return $result->getModifiedCount() > 0;
            }
        }

        return (bool) $result;
    }

    protected function reservationFilter(string $messageId, ?string $reservationToken = null): array {

        $filter = [
            '_id' => $messageId,
            'queue' => $this->queueName,
            'status' => 'reserved'
        ];

        if ($reservationToken !== null) {
            $filter['reservation_token'] = $reservationToken;
        }

        return $filter;
    }

    protected function consumeReservationToken(array &$data): ?string {

        $token = null;

        if (\array_key_exists($this->reservationTokenKey, $data)) {
            $token = \is_string($data[$this->reservationTokenKey]) ? $data[$this->reservationTokenKey] : null;
            unset($data[$this->reservationTokenKey]);
        }

        return $token;
    }

    protected function scheduleNextRepeatableMessage(array $message): void {

        if (!isset($message['repeat'])) {
            return;
        }

        $repeat = $message['repeat'];
        $currentTimestamp = \time();

        if (!empty($repeat['until']) && $repeat['until'] < $currentTimestamp) {
            return;
        }

        if (isset($repeat['count'])) {
            $repeat['count'] -= 1;
            if ($repeat['count'] <= 0) {
                return;
            }
        }

        $this->push($message['data'], [
            'priority' => $message['priority'],
            'maxAttempts' => $message['max_attempts'],
            'uid' => $message['uid'],
            'repeat' => $repeat,
        ]);
    }

    protected function calculateNextRepeatableInterval(string $interval, int $currentTimestamp): int {

        $interval = \trim($interval);

        // Check if the interval is a time of day (contains am/pm or is in 24h format like 15:00)
        if (
            \preg_match('/^(1[0-2]|0?[1-9])(?::([0-5][0-9]))?([ap]m)$/i', $interval) ||
            \preg_match('/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/', $interval)
        ) {
            // It's a time of day - calculate the next occurrence
            $dt = new \DateTime('@' . $currentTimestamp);
            $dt->setTimezone(new \DateTimeZone(\date_default_timezone_get()));
            $today = $dt->format('Y-m-d');

            // Try to parse the time for today
            $todayWithTime = \strtotime($today . ' ' . $interval);

            if ($todayWithTime > $currentTimestamp) {
                // If today's occurrence is in the future, use it
                return $todayWithTime;
            } else {
                // Otherwise, use tomorrow's occurrence
                $tomorrow = \strtotime('+1 day', \strtotime($today));
                $tomorrowFormatted = \date('Y-m-d', $tomorrow);
                return \strtotime($tomorrowFormatted . ' ' . $interval);
            }
        }

        // Support friendly names
        $mappings = [
            'hourly' => '1 hour',
            'daily' => '1 day',
            'weekly' => '1 week',
            'monthly' => '1 month',
            'yearly' => '1 year'
        ];

        $interval = $mappings[$interval] ?? $interval;

        // Use PHP's strtotime for calculation
        $nextTime = \strtotime("+{$interval}", $currentTimestamp);

        return $nextTime !== false ? $nextTime : $currentTimestamp + 86400; // Default to 1 day if parsing fails
    }

    public function reserve(): ?array {

        for ($retry = 0; $retry < 5; $retry++) {

            $timestamp = \time();

            $candidates = $this->storage->find($this->collectionName, [
                'limit' => 10,
                'sort' => ['priority' => -1, 'available_at' => 1],
                'filter' => [
                    'queue' => $this->queueName,
                    'status' => 'pending',
                    'available_at' => ['$lte' => $timestamp],
                ]
            ])->toArray();

            if (!$candidates) {
                return null;
            }

            foreach ($candidates as $message) {

                $reservationToken = $this->createReservationToken();
                $attempts = ($message['attempts'] ?? 0) + 1;

                $updated = $this->storage->update($this->collectionName, [
                    '_id' => $message['_id'],
                    'queue' => $this->queueName,
                    'status' => 'pending',
                    'attempts' => $message['attempts'] ?? 0,
                    'available_at' => ['$lte' => $timestamp],
                ], [
                    'attempts' => $attempts,
                    'status' => 'reserved',
                    'reserved_at' => $timestamp,
                    'reservation_token' => $reservationToken,
                ]);

                if (!$this->updateMatchedAny($updated)) {
                    continue;
                }

                return $this->storage->findOne($this->collectionName, [
                    '_id' => $message['_id'],
                    'queue' => $this->queueName,
                    'status' => 'reserved',
                    'reservation_token' => $reservationToken,
                ]);
            }
        }

        return null;
    }

    public function complete(string $messageId, array $data = []): bool {

        $reservationToken = $this->consumeReservationToken($data);
        $message = $this->storage->findOne($this->collectionName, $this->reservationFilter($messageId, $reservationToken));

        if (!$message) {
            return false;
        }

        $message = \array_merge($message, $data);

        $message['status'] = 'completed';
        $message['completed_at'] = \time();
        $message['reserved_at'] = null;
        $message['reservation_token'] = null;

        $this->storage->save($this->collectionName, $message);

        if (isset($message['repeat'])) {
            $this->scheduleNextRepeatableMessage($message);
        }

        return true;
    }

    public function fail(string $messageId, array $data = []): bool {

        $reservationToken = $this->consumeReservationToken($data);
        $message = $this->storage->findOne($this->collectionName, $this->reservationFilter($messageId, $reservationToken));

        if (!$message) {
            return false;
        }

        $message = \array_merge($message, $data);

        $message['status'] = (($message['attempts'] ?? 0) >= ($message['max_attempts'] ?? 1)) ? 'failed' : 'pending';
        $message['reserved_at'] = null;
        $message['reservation_token'] = null;
        $message['failed_at'] = $message['status'] === 'failed' ? \time() : null;

        $this->storage->save($this->collectionName, $message);

        if (isset($message['repeat'])) {

            $willBeRetried = (($message['attempts'] + 1) <= $message['max_attempts']);

            if (!$willBeRetried) {
                $this->scheduleNextRepeatableMessage($message);
            }
        }

        return true;
    }

    public function release(): void {

        $timestamp = \time();
        $lockExpiry = $timestamp - $this->lockTimeout;

        $this->storage->update($this->collectionName,[
            'queue' => $this->queueName,
            'status' => 'reserved',
            'reserved_at' => ['$lte' => $lockExpiry]
        ], [
            'status' => 'pending',
            'reserved_at' => null,
            'reservation_token' => null,
        ]);
    }

    public function delete(string|array $ids): void {

        if (\is_string($ids)) {
            $ids = [$ids];
        }

        $this->storage->remove($this->collectionName, [
            'queue' => $this->queueName,
            '_id' => ['$in' => $ids]
        ]);
    }

    public function messages(array $options = []): array {

        $options = \array_merge([
            'status' => $options['status'] ?? null,
            'limit' => 10,
            'skip' => 0,
            'sort' => ['created_at' => -1]
        ], $options);

        $filter = [
            'queue' => $this->queueName,
        ];

        if ($options['status']) {
            $filter['status'] = $options['status'];
        }

        if (isset($options['filter']) && \is_array($options['filter'])) {
            $filter = \array_merge($options['filter'], $filter);
        }

        return $this->storage->find($this->collectionName, [
            'filter' => $filter,
            'limit' => $options['limit'],
            'skip' => $options['skip'],
            'sort' => $options['sort'],
        ])->toArray();
    }

    public function count(?string $status = null): int|array {

        $filter = [
            'queue' => $this->queueName,
            'status' => $status,
        ];

        if (!$status) {

            $ret = [];

            foreach (['pending', 'reserved', 'completed', 'failed'] as $status) {
                $filter['status'] = $status;
                $ret[$status] = $this->storage->count($this->collectionName, $filter);
            }

            return $ret;
        }

        return $this->storage->count($this->collectionName, $filter);
    }

    public function cleanup(string $status, int $olderThan = 86400): void {

        $timestamp = \time();
        $cutoff = $timestamp - \abs($olderThan);
        $timestampField = match ($status) {
            'completed' => 'completed_at',
            'failed' => 'failed_at',
            default => 'created_at',
        };

        if ($timestampField === 'created_at') {

            $this->storage->remove($this->collectionName, [
                'queue' => $this->queueName,
                'status' => $status,
                'created_at' => ['$lte' => $cutoff]
            ]);

            return;
        }

        $filter = [
            'queue' => $this->queueName,
            'status' => $status,
            'created_at' => ['$lte' => $cutoff]
        ];

        $ids = [];

        foreach ($this->storage->find($this->collectionName, ['filter' => $filter])->toArray() as $message) {

            if (($message[$timestampField] ?? null) === null || $message[$timestampField] <= $cutoff) {
                $ids[] = $message['_id'];
            }
        }

        if ($ids) {
            $this->delete($ids);
        }
    }

    public function purge(): void {

        $this->storage->remove($this->collectionName, [
            'queue' => $this->queueName,
        ]);
    }

    public function worker(array $options = []): Worker {

        $worker = new Worker($this, $options);

        return $worker;
    }
}
