import React, { useEffect, useState } from 'react';
import './App.scss';
import RoomRow from './RoomRow';
import { SortArrow } from './SortArrow';
import { api, Room } from './Api';
import NewRoomForm from './NewRoomForm';

export type SortKey = 'name' | 'welcome' | 'maxParticipants' | 'record';

enum SortOrder { DESC = -1, ASC = 1 };

function sortRooms(key: SortKey, orderBy: SortOrder) {
	return (a: Room, b: Room) => {
		switch (key) {
		case 'name':
		case 'welcome':
			return a[key].localeCompare(b[key]) * orderBy;
		case 'maxParticipants':
			return (a.maxParticipants - b.maxParticipants) * orderBy;
		case 'record':
			if (a.record && !b.record) {
				return 1 * orderBy;
			}
			if (!a.record && b.record) {
				return -1 * orderBy;
			}

			return 0;
		}
	};
}

type Props = {

}

const App: React.FC<Props> = () => {
	const [areRoomsLoaded, setRoomsLoaded] = useState(false);
	const [rooms, setRooms] = useState<Room[]>([]);
	const [orderBy, setOrderBy] = useState<SortKey>('name');
	const [sortOrder, setSortOrder] = useState(SortOrder.ASC);

	const rows = rooms.sort(sortRooms(orderBy, sortOrder)).map(room => <RoomRow room={room} key={room.id} updateRoom={updateRoom} deleteRoom={deleteRoom} />);

	useEffect(() => {
		if (areRoomsLoaded) {
			return;
		}

		api.getRooms().then(rooms => {
			setRoomsLoaded(true);
			setRooms(rooms);
		});
	}, [areRoomsLoaded]);

	function onOrderBy(key: SortKey) {
		if (orderBy === key) {
			setSortOrder(sortOrder === SortOrder.ASC ? SortOrder.DESC : SortOrder.ASC);
		}

		setOrderBy(key);
	}

	function addRoom(name: string) {
		if (!name) {
			return;
		}

		api.createRoom(name).then(room => {
			setRooms(rooms.concat([room]));
		});
	}

	function updateRoom(room: Room) {
		api.updateRoom(room).then(updatedRoom => {
			setRooms(rooms.map(room => {
				if (room.id === updatedRoom.id) {
					return updatedRoom;
				}

				return room;
			}));
		});
	}

	function deleteRoom(id: number) {
		api.deleteRoom(id).then(deletedRoom => {
			setRooms(rooms.filter(room => room.id !== deletedRoom.id));
		});
	}

	return (
		<div id="bbb-react-root"
			onClick={() => { /* @TODO hide edit inputs */ }}>
			<table>
				<thead>
					<tr>
						<th />
						<th />
						<th onClick={() => onOrderBy('name')}>
							{t('bbb', 'Name')} <SortArrow name='name' value={orderBy} direction={sortOrder} />
						</th>
						<th onClick={() => onOrderBy('welcome')}>
							{t('bbb', 'Welcome')} <SortArrow name='welcome' value={orderBy} direction={sortOrder} />
						</th>
						<th onClick={() => onOrderBy('maxParticipants')}>
							{t('bbb', 'Max')} <SortArrow name='maxParticipants' value={orderBy} direction={sortOrder} />
						</th>
						<th onClick={() => onOrderBy('record')}>
							{t('bbb', 'Record')} <SortArrow name='record' value={orderBy} direction={sortOrder} />
						</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{rows}
				</tbody>
				<tfoot>
					<tr>
						<td colSpan={2} />
						<td>
							<NewRoomForm addRoom={addRoom} />
						</td>
						<td colSpan={4} />
					</tr>
				</tfoot>
			</table>
		</div>
	);
};

export default App;